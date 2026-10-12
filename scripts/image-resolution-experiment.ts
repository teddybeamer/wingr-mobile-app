#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Offline screenshot-resolution experiment (macOS only: sips, Vision OCR).
//
// Makes no network request and no AI call. It downsizes the ignored consented
// fixtures into a temporary directory (deleted afterwards), and reports only
// aggregate numbers: payload size and how much of the original on-screen text
// an OCR pass still recovers. Recognized text and images are never printed or
// written. OCR recall is a legibility proxy; it cannot judge ME/THEM bubble
// ownership, so any candidate still needs a fixture-based live review.

const SCREENSHOT_DIRECTORY = resolve(process.cwd(), "benchmarks/screenshots");
export const LONG_EDGES = [2048, 1792, 1536, 1280, 1024, 768] as const;
export const FORMATS = ["png", "jpeg85"] as const;
type Format = (typeof FORMATS)[number];

const words = (lines: string[]) =>
  lines
    .join(" ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);

/** Share of the reference words (as a multiset) that the candidate still contains. */
export function wordRecall(reference: string[], candidate: string[]) {
  const reference_ = words(reference);
  if (!reference_.length) return null;
  const remaining = new Map<string, number>();
  for (const word of words(candidate)) remaining.set(word, (remaining.get(word) ?? 0) + 1);
  let found = 0;
  for (const word of reference_) {
    const count = remaining.get(word) ?? 0;
    if (count > 0) {
      found++;
      remaining.set(word, count - 1);
    }
  }
  return found / reference_.length;
}

function ocr(binary: string, path: string): string[] {
  return JSON.parse(execFileSync(binary, [path], { maxBuffer: 16 * 1024 * 1024 }).toString());
}

function resize(input: string, output: string, longEdge: number | null, format: Format) {
  if (!longEdge && format === "png") return copyFileSync(input, output);
  const args = [] as string[];
  if (format === "jpeg85") args.push("-s", "format", "jpeg", "-s", "formatOptions", "85");
  if (longEdge) args.push("-Z", String(longEdge));
  execFileSync("sips", [...args, input, "--out", output], { stdio: "ignore" });
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "wingr-resolution-"));
  try {
    const binary = join(work, "ocr-text");
    execFileSync("swiftc", ["-O", resolve("scripts/ocr-text.swift"), "-o", binary], { stdio: "ignore" });
    const fixtures = readdirSync(SCREENSHOT_DIRECTORY).filter((name) => /\.(png)$/i.test(name)).sort();
    if (!fixtures.length) throw new Error("No fixtures in benchmarks/screenshots.");
    const rows: { label: string; base64Kb: number; recalls: number[] }[] = [];
    const candidates: [string, number | null, Format][] = [
      ["original png", null, "png"],
      ...FORMATS.flatMap((format) =>
        LONG_EDGES.map((edge) => [`${edge}px ${format}`, edge, format] as [string, number, Format]),
      ),
    ];
    const references = fixtures.map((name) => ocr(binary, join(SCREENSHOT_DIRECTORY, name)));
    for (const [label, edge, format] of candidates) {
      const sizes: number[] = [];
      const recalls: number[] = [];
      fixtures.forEach((name, index) => {
        const output = join(work, `${index}-${label.replace(/\W+/g, "-")}.${format === "png" ? "png" : "jpg"}`);
        resize(join(SCREENSHOT_DIRECTORY, name), output, edge, format);
        sizes.push(statSync(output).size);
        const recall = wordRecall(references[index], ocr(binary, output));
        if (recall !== null) recalls.push(recall);
      });
      rows.push({
        base64Kb: Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 4 / 3 / 1024),
        label,
        recalls,
      });
    }
    console.log(`Fixtures: ${fixtures.length}. OCR word recall vs the original (aggregate only).`);
    console.log("candidate".padEnd(18), "avg base64 KB".padEnd(14), "min recall".padEnd(11), "avg recall");
    for (const row of rows) {
      const min = Math.min(...row.recalls);
      const avg = row.recalls.reduce((a, b) => a + b, 0) / row.recalls.length;
      console.log(
        row.label.padEnd(18),
        String(row.base64Kb).padEnd(14),
        `${(min * 100).toFixed(1)}%`.padEnd(11),
        `${(avg * 100).toFixed(1)}%`,
      );
    }
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`Experiment stopped: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
