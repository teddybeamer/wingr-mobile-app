import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

// Reads the ignored benchmark fixtures as a numbered set (fixture-NN.<ext>),
// rejecting bad names or bytes and dropping byte-identical duplicates so a repeated
// screenshot can never be counted (and paid for) twice.

const NAME = /^fixture-(\d{2})\.(png|jpe?g|webp)$/i;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export type FixtureEntry = {
  dataUrl: string;
  name: string;
  number: number;
};
export type FixtureSet = {
  duplicates: { duplicate: string; of: string }[];
  fixtures: FixtureEntry[];
};

function hasSignature(mime: string, bytes: Buffer) {
  const at = (expected: number[], offset = 0) =>
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte);
  if (mime === "image/png") return at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === "image/jpeg") return at([0xff, 0xd8, 0xff]);
  return at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8);
}

/** Parses "4,6,10" or "04,06" into fixture numbers; throws on anything else. */
export function parseFixtureSelection(value: string) {
  const numbers = value.split(",").map((part) => Number(part.trim()));
  if (!numbers.length || numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 99))
    throw new Error("--fixtures must be a comma-separated list of fixture numbers, e.g. 4,6,8.");
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export function readFixtureSet(
  directory: string,
  selection?: number[],
): FixtureSet {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  const invalid = files.filter((name) => !NAME.test(name));
  if (invalid.length)
    throw new Error("Fixtures must be named fixture-NN.png (or jpg/jpeg/webp).");
  if (!files.length) throw new Error("No fixtures found in benchmarks/screenshots.");
  const seen = new Map<string, string>();
  const fixtures: FixtureEntry[] = [];
  const duplicates: FixtureSet["duplicates"] = [];
  for (const name of files) {
    const number = Number(NAME.exec(name)![1]);
    const mime = MIME[extname(name).toLowerCase()];
    const bytes = readFileSync(join(directory, name));
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES)
      throw new Error("Each fixture must be non-empty and at most 10 MiB.");
    if (!hasSignature(mime, bytes))
      throw new Error("Each fixture's bytes must match its file type.");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const original = seen.get(hash);
    if (original) {
      duplicates.push({ duplicate: name, of: original });
      continue;
    }
    seen.set(hash, name);
    if (selection && !selection.includes(number)) continue;
    fixtures.push({
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      name,
      number,
    });
  }
  if (selection) {
    const missing = selection.filter((n) => !fixtures.some((f) => f.number === n));
    if (missing.length)
      throw new Error(
        `Selected fixtures not available (missing or duplicates): ${missing.join(", ")}.`,
      );
  }
  return { duplicates, fixtures };
}
