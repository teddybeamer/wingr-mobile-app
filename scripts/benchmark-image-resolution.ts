#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addressesReader, lintVibeCheck } from "./vibe-voice-lint";
import {
  completedResponseContent,
  loadCompact,
  stagingCredentials,
  validateFixtureNames,
} from "./benchmark-ai-output";

// Isolated A/B: the same consented fixtures sent as the original image and
// downscaled to a 1280 px long edge. Everything else (compact baseline request,
// prompt, schema, medium reasoning, Vertex-only/ZDR routing, tone, deadline) is
// built by the same production code, so the image is the only variable.
//
// A dry run (default) makes no network request, reads no credentials and only
// verifies fixtures and resizing. Live calls need BOTH --execute and
// BENCHMARK_CONFIRM_LIVE_API=yes plus the ignored staging-only key.

const ROOT = resolve(process.cwd());
const SCREENSHOT_DIRECTORY = join(ROOT, "benchmarks/screenshots");
const RESULT_DIRECTORY = join(ROOT, "benchmarks/results");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 45_000;
const RESIZED_LONG_EDGE = 1280;
const DEFAULT_RUNS = 3;
const MAX_RUNS = 5;

export type Variant = "original" | "resized1280";
export const QUALITY_FIELDS = [
  "replyable",
  "interestLevel",
  "conversationEnergy",
  "bestTone",
  "risk",
] as const;
export type Quality = Record<(typeof QUALITY_FIELDS)[number], string> & {
  addressesReader: boolean;
  replyChars: number;
  summaryChars: number;
  // Number of user-facing vibe text fields with an internal label or report-style opening.
  voiceIssueFields: number;
};
export type Run = {
  fixtureIndex: number;
  inputTokens: number | null;
  latencyMs: number;
  outputTokens: number | null;
  quality: Quality | null;
  reasoningTokens: number | null;
  review: {
    conversationEnergy?: string;
    reply: string;
    risk?: string;
    summary: string;
  } | null;
  status: "valid" | "request_error" | "validation_error";
  variant: string;
};

function fail(message: string): never {
  throw new Error(message);
}

export function plannedRuns(fixtureIndex: number, runs = DEFAULT_RUNS): Variant[] {
  const first: Variant = fixtureIndex % 2 === 0 ? "original" : "resized1280";
  const second: Variant = first === "original" ? "resized1280" : "original";
  return Array.from({ length: runs }, () => [first, second]).flat();
}

export function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function nearestRank(values: number[], percentile: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(percentile * ordered.length) - 1];
}

/** Share of agreeing pairs: within one group, or across two groups. */
export function agreement(left: string[], right?: string[]) {
  let agree = 0;
  let pairs = 0;
  if (right) {
    for (const a of left)
      for (const b of right) {
        pairs++;
        if (a === b) agree++;
      }
  } else {
    for (let i = 0; i < left.length; i++)
      for (let j = i + 1; j < left.length; j++) {
        pairs++;
        if (left[i] === left[j]) agree++;
      }
  }
  return pairs ? agree / pairs : null;
}

export function qualityOf(result: unknown): Quality | null {
  const value = result as {
    replies?: unknown[];
    replyable?: unknown;
    vibeCheck?: Record<string, unknown> | null;
  };
  if (typeof value?.replyable !== "boolean") return null;
  const vibe = value.vibeCheck;
  const text = (field: string) =>
    vibe && typeof vibe[field] === "string" ? (vibe[field] as string) : "none";
  return {
    addressesReader: addressesReader(text("summary")),
    summaryChars: text("summary") === "none" ? 0 : text("summary").length,
    voiceIssueFields: Object.keys(lintVibeCheck((vibe ?? null) as never)).length,
    bestTone: text("bestTone"),
    conversationEnergy: text("conversationEnergy"),
    interestLevel: text("interestLevel"),
    replyChars:
      typeof value.replies?.[0] === "string" ? value.replies[0].length : 0,
    replyable: String(value.replyable),
    risk: text("risk"),
  };
}

export function summarizeVariant(runs: Run[]) {
  const valid = runs.filter((run) => run.status === "valid");
  const tokens = (pick: (run: Run) => number | null) => {
    const values = valid.map(pick);
    return values.length && values.every((value) => value !== null)
      ? median(values as number[])
      : null;
  };
  return {
    attemptedRuns: runs.length,
    medianInputTokens: tokens((run) => run.inputTokens),
    medianLatencyMs: median(valid.map((run) => run.latencyMs)),
    medianOutputTokens: tokens((run) => run.outputTokens),
    medianReasoningTokens: tokens((run) => run.reasoningTokens),
    p90LatencyMs: nearestRank(valid.map((run) => run.latencyMs), 0.9),
    requestErrors: runs.filter((run) => run.status === "request_error").length,
    successfulRuns: valid.length,
    validationErrors: runs.filter((run) => run.status === "validation_error")
      .length,
  };
}

function mean(numbers: (number | null)[]) {
  const present = numbers.filter((n): n is number => n !== null);
  return present.length
    ? Number((present.reduce((a, b) => a + b, 0) / present.length).toFixed(3))
    : null;
}

function qualityReport(runs: Run[]) {
  const valid = runs.filter((run) => run.status === "valid" && run.quality);
  const fixtures = [...new Set(valid.map((run) => run.fixtureIndex))];
  const fields: Record<
    string,
    {
      acrossVariants: number | null;
      withinOriginal: number | null;
      withinResized: number | null;
    }
  > = {};
  for (const field of QUALITY_FIELDS) {
    const values = (variant: Variant, fixtureIndex: number) =>
      valid
        .filter(
          (run) => run.variant === variant && run.fixtureIndex === fixtureIndex,
        )
        .map((run) => run.quality![field]);
    fields[field] = {
      acrossVariants: mean(
        fixtures.map((i) =>
          agreement(values("original", i), values("resized1280", i)),
        ),
      ),
      withinOriginal: mean(fixtures.map((i) => agreement(values("original", i)))),
      withinResized: mean(
        fixtures.map((i) => agreement(values("resized1280", i))),
      ),
    };
  }
  const replyLength = (variant: Variant) =>
    median(
      valid
        .filter((run) => run.variant === variant)
        .map((run) => run.quality!.replyChars),
    );
  return {
    fields,
    medianReplyChars: {
      original: replyLength("original"),
      resized1280: replyLength("resized1280"),
    },
  };
}

function percentChange(original: number | null, resized: number | null) {
  if (original === null || resized === null || original === 0) return null;
  return Number((((resized - original) / original) * 100).toFixed(2));
}

export function buildReport(
  runs: Run[],
  fixtureCount: number,
  runsPerVariant: number,
  sizes: Record<string, number>,
) {
  const original = summarizeVariant(runs.filter((r) => r.variant === "original"));
  const resized = summarizeVariant(
    runs.filter((r) => r.variant === "resized1280"),
  );
  const inputMedian = (index: number, variant: Variant) =>
    median(
      runs
        .filter(
          (r) =>
            r.fixtureIndex === index &&
            r.variant === variant &&
            r.inputTokens !== null,
        )
        .map((r) => r.inputTokens!),
    );
  return {
    changePercent: {
      inputTokens: percentChange(
        original.medianInputTokens,
        resized.medianInputTokens,
      ),
      latencyMedian: percentChange(
        original.medianLatencyMs,
        resized.medianLatencyMs,
      ),
      latencyP90: percentChange(original.p90LatencyMs, resized.p90LatencyMs),
      outputTokens: percentChange(
        original.medianOutputTokens,
        resized.medianOutputTokens,
      ),
      reasoningTokens: percentChange(
        original.medianReasoningTokens,
        resized.medianReasoningTokens,
      ),
    },
    fixtureCount,
    latencyDefinition:
      "Client-side wall-clock time from OpenRouter fetch dispatch until the complete non-streaming response is parsed.",
    payloadBase64KbAverage: sizes,
    perFixtureMedianInputTokens: Array.from(
      { length: fixtureCount },
      (_, index) => ({
        original: inputMedian(index, "original"),
        resized1280: inputMedian(index, "resized1280"),
      }),
    ),
    quality: qualityReport(runs),
    resizedLongEdgePx: RESIZED_LONG_EDGE,
    runsPerVariantPerFixture: runsPerVariant,
    summaries: { original, resized1280: resized },
  };
}

function markdown(report: ReturnType<typeof buildReport>) {
  const { original, resized1280 } = report.summaries;
  const row = (name: string, a: unknown, b: unknown) =>
    `| ${name} | ${String(a)} | ${String(b)} |`;
  const quality = Object.entries(report.quality.fields)
    .map(
      ([field, v]) =>
        `| ${field} | ${v.withinOriginal} | ${v.withinResized} | ${v.acrossVariants} |`,
    )
    .join("\n");
  return (
    `# WiNGR image-resolution A/B (original vs ${report.resizedLongEdgePx}px)\n\n` +
    `Aggregate-only report. No screenshots, prompts, AI output, credentials, or user identifiers are included.\n\n` +
    `- Runs: ${report.fixtureCount} fixtures × ${report.runsPerVariantPerFixture} runs per variant\n` +
    `- Latency: ${report.latencyDefinition}\n\n` +
    `| Metric | Original | ${report.resizedLongEdgePx}px |\n| --- | ---: | ---: |\n` +
    [
      row("Valid runs", original.successfulRuns, resized1280.successfulRuns),
      row("Validation errors", original.validationErrors, resized1280.validationErrors),
      row("Request errors", original.requestErrors, resized1280.requestErrors),
      row("Median latency (ms)", original.medianLatencyMs, resized1280.medianLatencyMs),
      row("P90 latency (ms)", original.p90LatencyMs, resized1280.p90LatencyMs),
      row("Median input tokens", original.medianInputTokens, resized1280.medianInputTokens),
      row("Median output tokens", original.medianOutputTokens, resized1280.medianOutputTokens),
      row("Median reasoning tokens", original.medianReasoningTokens, resized1280.medianReasoningTokens),
    ].join("\n") +
    `\n\nChange (resized vs original, %): ${JSON.stringify(report.changePercent)}\n` +
    `Per-fixture median input tokens: ${JSON.stringify(report.perFixtureMedianInputTokens)}\n\n` +
    `## Structured-output agreement (1 = always identical; within-original is the noise floor)\n\n` +
    `| Field | Within original | Within resized | Across |\n| --- | ---: | ---: | ---: |\n${quality}\n\n` +
    `Median reply length (chars): ${JSON.stringify(report.quality.medianReplyChars)}\n\n` +
    `Agreement cannot judge ME/THEM ownership, small messages or cropped bubbles. Review those manually (see benchmarks/README.md).\n`
  );
}

function sipsDimensions(path: string) {
  const out = execFileSync("sips", [
    "-g",
    "pixelWidth",
    "-g",
    "pixelHeight",
    path,
  ]).toString();
  return [
    Number(/pixelWidth: (\d+)/.exec(out)?.[1]),
    Number(/pixelHeight: (\d+)/.exec(out)?.[1]),
  ] as const;
}

function prepareFixtures(directory: string) {
  const files = readdirSync(SCREENSHOT_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^fixture-0[1-3]\./i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  validateFixtureNames(files);
  return files.map((name, index) => {
    if (extname(name).toLowerCase() !== ".png")
      fail("This experiment expects PNG fixtures.");
    const original = join(directory, `original-${index}.png`);
    const resized = join(directory, `resized-${index}.png`);
    copyFileSync(join(SCREENSHOT_DIRECTORY, name), original);
    execFileSync(
      "sips",
      ["-Z", String(RESIZED_LONG_EDGE), original, "--out", resized],
      { stdio: "ignore" },
    );
    const [width, height] = sipsDimensions(resized);
    if (Math.max(width, height) !== RESIZED_LONG_EDGE)
      fail("Resizing did not produce the expected long edge.");
    const [originalWidth, originalHeight] = sipsDimensions(original);
    if (Math.abs(width / height - originalWidth / originalHeight) > 0.005)
      fail("Resizing changed the aspect ratio (no cropping is allowed).");
    const dataUrl = (path: string) =>
      `data:image/png;base64,${readFileSync(path).toString("base64")}`;
    return {
      original: dataUrl(original),
      originalBytes: statSync(original).size,
      pixels: {
        original: originalWidth * originalHeight,
        resized: width * height,
      },
      resized: dataUrl(resized),
      resizedBytes: statSync(resized).size,
    };
  });
}

export async function runOnce(
  implementation: Awaited<ReturnType<typeof loadCompact>>,
  apiKey: string,
  screenshot: string,
  variant: string,
  fixtureIndex: number,
  keepReview: boolean,
  adjustRequest: (request: unknown) => unknown = (request) => request,
): Promise<Run> {
  const request = adjustRequest(
    implementation.buildRequest({ screenshot, selectedTone: "playful" }),
  );
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const base = {
    fixtureIndex,
    inputTokens: null,
    outputTokens: null,
    quality: null,
    reasoningTokens: null,
    review: null,
    variant,
  };
  try {
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        body: JSON.stringify(request),
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      });
    } catch {
      return {
        ...base,
        latencyMs: performance.now() - startedAt,
        status: "request_error",
      };
    }
    if (!response.ok)
      return {
        ...base,
        latencyMs: performance.now() - startedAt,
        status: "request_error",
      };
    try {
      const payload = await response.json();
      const content = completedResponseContent(payload);
      if (content === null) throw new Error("invalid response shape");
      const result = implementation.parseResult(JSON.parse(content));
      const latencyMs = performance.now() - startedAt;
      const usage = (
        payload as {
          usage?: Record<string, unknown> & {
            completion_tokens_details?: { reasoning_tokens?: unknown };
          };
        }
      ).usage;
      const count = (value: unknown) =>
        typeof value === "number" && Number.isInteger(value) && value >= 0
          ? value
          : null;
      const typed = result as {
        replies?: string[];
        vibeCheck?: {
          conversationEnergy?: string;
          risk?: string;
          summary?: string;
        } | null;
      };
      return {
        ...base,
        inputTokens: count(usage?.prompt_tokens),
        latencyMs,
        outputTokens: count(usage?.completion_tokens),
        quality: qualityOf(result),
        reasoningTokens:
          count(usage?.reasoning_tokens) ??
          count(usage?.completion_tokens_details?.reasoning_tokens),
        review: keepReview
          ? {
              conversationEnergy: typed.vibeCheck?.conversationEnergy ?? "",
              reply: typed.replies?.[0] ?? "",
              risk: typed.vibeCheck?.risk ?? "",
              summary: typed.vibeCheck?.summary ?? "",
            }
          : null,
        status: "valid",
      };
    } catch {
      return {
        ...base,
        latencyMs: performance.now() - startedAt,
        status: "validation_error",
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

function writePrivate(filename: string, contents: string) {
  mkdirSync(RESULT_DIRECTORY, { recursive: true });
  const destination = join(RESULT_DIRECTORY, filename);
  writeFileSync(`${destination}.next`, contents, { mode: 0o600 });
  renameSync(`${destination}.next`, destination);
}

function reviewFile(runs: Run[]) {
  const lines = [
    "# LOCAL ONLY - contains model output for consented fixtures. Ignored by Git. Do not share.",
    "",
    "For each fixture compare original vs resized runs. Tick every item:",
    "- [ ] ME/THEM ownership of the latest message is the same and correct",
    "- [ ] Short messages (haha, emoji) are still respected",
    "- [ ] Cropped bottom bubble handled without invented text",
    "- [ ] Language and tone unchanged; reply grounded in the latest hook",
    "",
  ];
  for (const index of [...new Set(runs.map((run) => run.fixtureIndex))]) {
    lines.push(`## Fixture ${index + 1}`);
    for (const variant of ["original", "resized1280"] as Variant[]) {
      runs
        .filter(
          (run) =>
            run.fixtureIndex === index && run.variant === variant && run.review,
        )
        .forEach((run, n) =>
          lines.push(
            `- ${variant} #${n + 1}: summary: ${run.review!.summary} | reply: ${run.review!.reply}`,
          ),
        );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const keepReview = args.includes("--write-review");
  const runsFlag = args.indexOf("--runs");
  const runsPerVariant =
    runsFlag >= 0 ? Number(args[runsFlag + 1]) : DEFAULT_RUNS;
  if (
    !Number.isInteger(runsPerVariant) ||
    runsPerVariant < 1 ||
    runsPerVariant > MAX_RUNS
  )
    fail(`--runs must be an integer from 1 to ${MAX_RUNS}.`);
  const work = mkdtempSync(join(tmpdir(), "wingr-resolution-ab-"));
  const implementation = await loadCompact();
  try {
    const fixtures = prepareFixtures(work);
    const kb = (bytes: number[]) =>
      Math.round(
        (bytes.reduce((a, b) => a + b, 0) / bytes.length) * (4 / 3) / 1024,
      );
    const sizes = {
      original: kb(fixtures.map((f) => f.originalBytes)),
      resized1280: kb(fixtures.map((f) => f.resizedBytes)),
    };
    const pixelChange = fixtures.map((f) =>
      Math.round((1 - f.pixels.resized / f.pixels.original) * 100),
    );
    const planned = fixtures.flatMap((_, index) =>
      plannedRuns(index, runsPerVariant),
    );
    if (!execute) {
      console.log(
        `Dry run ready: ${fixtures.length} fixtures, ${planned.length} paid OpenRouter calls after --execute ` +
          `(${runsPerVariant} per variant per fixture). Average base64 KB ${JSON.stringify(sizes)}; ` +
          `pixel reduction per fixture ${JSON.stringify(pixelChange)}%.`,
      );
      return;
    }
    if (process.env.BENCHMARK_CONFIRM_LIVE_API !== "yes")
      fail(
        "Set BENCHMARK_CONFIRM_LIVE_API=yes immediately before using --execute.",
      );
    const apiKey = stagingCredentials();
    const runs: Run[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const [index, fixture] of fixtures.entries()) {
      for (const variant of plannedRuns(index, runsPerVariant)) {
        runs.push(
          await runOnce(
            implementation,
            apiKey,
            variant === "original" ? fixture.original : fixture.resized,
            variant,
            index,
            keepReview,
          ),
        );
        writePrivate(
          `image-resolution-${timestamp}.partial.json`,
          `${JSON.stringify(buildReport(runs, fixtures.length, runsPerVariant, sizes), null, 2)}\n`,
        );
      }
    }
    const report = buildReport(runs, fixtures.length, runsPerVariant, sizes);
    writePrivate(
      `image-resolution-${timestamp}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writePrivate(`image-resolution-${timestamp}.md`, markdown(report));
    rmSync(join(RESULT_DIRECTORY, `image-resolution-${timestamp}.partial.json`), {
      force: true,
    });
    if (keepReview)
      writePrivate(
        `image-resolution-review-${timestamp}.local.md`,
        reviewFile(runs),
      );
    console.log(
      "A/B complete. Aggregate-only report saved in benchmarks/results/.",
    );
  } finally {
    implementation.dispose();
    rmSync(work, { force: true, recursive: true });
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(
      `Benchmark stopped: ${error instanceof Error ? error.message : "Unknown setup error."}`,
    );
    process.exitCode = 1;
  });
}
