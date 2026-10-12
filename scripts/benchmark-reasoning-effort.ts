#!/usr/bin/env node

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCompact, stagingCredentials } from "./benchmark-ai-output";
import { parseFixtureSelection, readFixtureSet } from "./fixture-set";
import {
  agreement,
  median,
  runOnce,
  summarizeVariant,
  type Run,
} from "./benchmark-image-resolution";

// Isolated A/B of reasoning effort: "medium" (current production) vs "low".
//
// Both requests are built by the production code from the same fixtures
// (original resolution), prompt, JSON contract, tone and Vertex-only/ZDR routing.
// Only `reasoning.effort` differs; the dry run asserts that, and every live
// request is re-checked before it is sent. Production keeps medium: a previous
// low-reasoning experiment regressed quality, so a result here is evidence for a
// manual review, not a deployment recommendation.
//
// A dry run (default) makes no network request and reads no credentials. Live
// calls need BOTH --execute and BENCHMARK_CONFIRM_LIVE_API=yes plus the ignored
// staging-only key.

const ROOT = resolve(process.cwd());
const RESULT_DIRECTORY = join(ROOT, "benchmarks/results");
const SCREENSHOT_DIRECTORY = join(ROOT, "benchmarks/screenshots");
// Rough per-call cost from OpenRouter list prices and the medians measured so far
// (USD). An estimate for budgeting only, not a billing figure.
const ESTIMATED_COST_PER_CALL = { low: 0.0021, medium: 0.0039 };
const DEFAULT_RUNS = 3;
const MAX_RUNS = 5;
const EXPECTED_PROVIDER = {
  allow_fallbacks: false,
  data_collection: "deny",
  only: ["google-vertex/global"],
  require_parameters: true,
  zdr: true,
};

export type Effort = "medium" | "low";
const EFFORTS: Effort[] = ["medium", "low"];

type Request = Record<string, unknown> & {
  provider?: unknown;
  reasoning?: { effort?: unknown };
};

function fail(message: string): never {
  throw new Error(message);
}

// Key-order-independent serialization for comparing configuration objects.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function withReasoningEffort(request: unknown, effort: Effort) {
  const value = request as Request;
  return { ...value, reasoning: { ...value.reasoning, effort } };
}

/** Throws unless the request keeps the production safety/quality contract. */
export function assertRequestContract(request: unknown, effort: Effort) {
  const value = request as Request;
  if (value.reasoning?.effort !== effort)
    fail("Unexpected reasoning effort in benchmark request.");
  if (canonical(value.provider) !== canonical(EXPECTED_PROVIDER))
    fail("Provider routing must stay Vertex-only with ZDR and no fallback.");
  if (value.model !== "google/gemini-3.8-flash")
    fail("The benchmark must use the production Gemini model.");
}

/** The two variants must differ in reasoning effort only. */
export function assertOnlyEffortDiffers(medium: unknown, low: unknown) {
  if (
    JSON.stringify(withReasoningEffort(low, "medium")) !==
    JSON.stringify(withReasoningEffort(medium, "medium"))
  )
    fail("Variants differ in more than reasoning effort.");
}

export function plannedRuns(fixtureIndex: number, runs = DEFAULT_RUNS): Effort[] {
  const first = EFFORTS[fixtureIndex % 2];
  const second = EFFORTS[(fixtureIndex + 1) % 2];
  return Array.from({ length: runs }, () => [first, second]).flat();
}

function percentChange(from: number | null, to: number | null) {
  if (from === null || to === null || from === 0) return null;
  return Number((((to - from) / from) * 100).toFixed(2));
}

export function buildReport(runs: Run[], fixtureCount: number, runsPerVariant: number) {
  const of = (variant: Effort) => runs.filter((run) => run.variant === variant);
  const medium = summarizeVariant(of("medium"));
  const low = summarizeVariant(of("low"));
  const valid = (variant: Effort) =>
    of(variant).filter((run) => run.status === "valid" && run.quality);
  const share = (variant: Effort, predicate: (q: NonNullable<Run["quality"]>) => boolean) => {
    const list = valid(variant);
    return list.length ? Number((list.filter((run) => predicate(run.quality!)).length / list.length).toFixed(3)) : null;
  };
  const fixtures = [...new Set(valid("medium").map((run) => run.fixtureIndex))];
  const field = (name: "replyable" | "interestLevel" | "bestTone") => {
    const values = (variant: Effort, index: number) =>
      valid(variant).filter((run) => run.fixtureIndex === index).map((run) => run.quality![name]);
    const mean = (numbers: (number | null)[]) => {
      const present = numbers.filter((n): n is number => n !== null);
      return present.length ? Number((present.reduce((a, b) => a + b, 0) / present.length).toFixed(3)) : null;
    };
    return {
      across: mean(fixtures.map((i) => agreement(values("medium", i), values("low", i)))),
      withinLow: mean(fixtures.map((i) => agreement(values("low", i)))),
      withinMedium: mean(fixtures.map((i) => agreement(values("medium", i)))),
    };
  };
  const replyChars = (variant: Effort) => median(valid(variant).map((run) => run.quality!.replyChars));
  return {
    changePercentLowVsMedium: {
      latencyMedian: percentChange(medium.medianLatencyMs, low.medianLatencyMs),
      latencyP90: percentChange(medium.p90LatencyMs, low.p90LatencyMs),
      outputTokens: percentChange(medium.medianOutputTokens, low.medianOutputTokens),
      reasoningTokens: percentChange(medium.medianReasoningTokens, low.medianReasoningTokens),
    },
    fixtureCount,
    latencyDefinition:
      "Client-side wall-clock time from OpenRouter fetch dispatch until the complete non-streaming response is parsed.",
    quality: {
      agreement: { bestTone: field("bestTone"), interestLevel: field("interestLevel"), replyable: field("replyable") },
      medianReplyChars: { low: replyChars("low"), medium: replyChars("medium") },
      unreplyableShare: {
        low: share("low", (q) => q.replyable === "false"),
        medium: share("medium", (q) => q.replyable === "false"),
      },
    },
    runsPerVariantPerFixture: runsPerVariant,
    summaries: { low, medium },
  };
}

function markdown(report: ReturnType<typeof buildReport>) {
  const { low, medium } = report.summaries;
  const row = (name: string, a: unknown, b: unknown) => `| ${name} | ${String(a)} | ${String(b)} |`;
  return (
    `# WiNGR reasoning-effort A/B (medium vs low)\n\n` +
    `Aggregate-only report. No screenshots, prompts, AI output, credentials, or user identifiers are included.\n\n` +
    `- Runs: ${report.fixtureCount} fixtures × ${report.runsPerVariantPerFixture} runs per variant\n` +
    `- Latency: ${report.latencyDefinition}\n\n` +
    `| Metric | Medium | Low |\n| --- | ---: | ---: |\n` +
    [
      row("Valid runs", medium.successfulRuns, low.successfulRuns),
      row("Validation errors", medium.validationErrors, low.validationErrors),
      row("Request errors", medium.requestErrors, low.requestErrors),
      row("Median latency (ms)", medium.medianLatencyMs, low.medianLatencyMs),
      row("P90 latency (ms)", medium.p90LatencyMs, low.p90LatencyMs),
      row("Median input tokens", medium.medianInputTokens, low.medianInputTokens),
      row("Median output tokens", medium.medianOutputTokens, low.medianOutputTokens),
      row("Median reasoning tokens", medium.medianReasoningTokens, low.medianReasoningTokens),
    ].join("\n") +
    `\n\nChange (low vs medium, %): ${JSON.stringify(report.changePercentLowVsMedium)}\n` +
    `Unreplyable share: ${JSON.stringify(report.quality.unreplyableShare)}\n` +
    `Median reply length (chars): ${JSON.stringify(report.quality.medianReplyChars)}\n` +
    `Enum agreement (within-medium is the noise floor): ${JSON.stringify(report.quality.agreement)}\n\n` +
    `Automatic agreement cannot judge ME/THEM, context or naturalness. Do the blinded manual review BEFORE reading this report.\n`
  );
}

// ---- Blinded manual review ------------------------------------------------

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HARD_CRITERIA = ["ownership", "noInventedFacts", "language"] as const;
export const SCALE_CRITERIA = ["hook", "natural", "flirt"] as const;
type Labelled = "A" | "B";
export type ReviewKey = Record<string, Record<Labelled, Effort>>;
type OutputScore = Partial<Record<(typeof HARD_CRITERIA)[number], boolean | null>> &
  Partial<Record<(typeof SCALE_CRITERIA)[number], number | null>>;
export type ReviewScores = Record<string, { A: OutputScore; B: OutputScore; preferred?: Labelled | "tie" | null }>;

/** Pairs the n-th medium and low run of each fixture and hides which is which. */
export function buildBlindedReview(runs: Run[], seed: number) {
  const random = seededRandom(seed);
  const key: ReviewKey = {};
  const scores: ReviewScores = {};
  const lines = [
    "# LOCAL ONLY - blinded review of model output for consented fixtures. Ignored by Git. Do not share.",
    "",
    "Do NOT open the aggregate report or the key file before scoring.",
    "Hard criteria (true/false): ownership = latest message owner and ME/THEM perspective are correct;",
    "noInventedFacts = no invented facts or unseen text; language = same language as the conversation.",
    "Scale (1-5): hook = uses the latest relevant hook and context; natural = sounds like a short, natural, sendable text.",
    "Also check small messages (haha, emoji) and a cropped bottom bubble. Fill the scores template, then run --score.",
    "",
  ];
  const fixtures = [...new Set(runs.map((run) => run.fixtureIndex))].sort();
  for (const index of fixtures) {
    const pick = (variant: Effort) =>
      runs.filter((run) => run.fixtureIndex === index && run.variant === variant && run.review);
    const medium = pick("medium");
    const low = pick("low");
    for (let n = 0; n < Math.min(medium.length, low.length); n++) {
      const id = `F${index + 1}-${n + 1}`;
      const flip = random() < 0.5;
      const A = flip ? low[n] : medium[n];
      const B = flip ? medium[n] : low[n];
      key[id] = { A: flip ? "low" : "medium", B: flip ? "medium" : "low" };
      scores[id] = { A: {}, B: {}, preferred: null };
      lines.push(
        `## ${id}`,
        `- A: summary: ${A.review!.summary} | reply: ${A.review!.reply}`,
        `- B: summary: ${B.review!.summary} | reply: ${B.review!.reply}`,
        "",
      );
    }
  }
  return { key, review: lines.join("\n"), scores };
}

/** Unblinds scores into per-variant totals. Contains no model text. */
export function scoreReview(key: ReviewKey, scores: ReviewScores) {
  const totals: Record<Effort, { count: number; hardFailures: Record<string, number>; scaleSums: Record<string, number>; scaleCounts: Record<string, number> }> = {
    low: { count: 0, hardFailures: {}, scaleCounts: {}, scaleSums: {} },
    medium: { count: 0, hardFailures: {}, scaleCounts: {}, scaleSums: {} },
  };
  const preferences = { low: 0, medium: 0, tie: 0 };
  for (const [id, mapping] of Object.entries(key)) {
    const entry = scores[id];
    if (!entry) continue;
    for (const label of ["A", "B"] as Labelled[]) {
      const variant = mapping[label];
      const score = entry[label] ?? {};
      totals[variant].count++;
      for (const criterion of HARD_CRITERIA)
        if (score[criterion] === false)
          totals[variant].hardFailures[criterion] = (totals[variant].hardFailures[criterion] ?? 0) + 1;
      for (const criterion of SCALE_CRITERIA) {
        const value = score[criterion];
        if (typeof value === "number" && value >= 1 && value <= 5) {
          totals[variant].scaleSums[criterion] = (totals[variant].scaleSums[criterion] ?? 0) + value;
          totals[variant].scaleCounts[criterion] = (totals[variant].scaleCounts[criterion] ?? 0) + 1;
        }
      }
    }
    if (entry.preferred === "tie") preferences.tie++;
    else if (entry.preferred === "A" || entry.preferred === "B") preferences[mapping[entry.preferred]]++;
  }
  const summary = (variant: Effort) => ({
    hardFailures: totals[variant].hardFailures,
    outputs: totals[variant].count,
    scaleMeans: Object.fromEntries(
      Object.entries(totals[variant].scaleSums).map(([name, sum]) => [
        name,
        Number((sum / totals[variant].scaleCounts[name]).toFixed(2)),
      ]),
    ),
  });
  return { low: summary("low"), medium: summary("medium"), preferences };
}

// ---- Runner ----------------------------------------------------------------

function writePrivate(filename: string, contents: string) {
  mkdirSync(RESULT_DIRECTORY, { recursive: true });
  const destination = join(RESULT_DIRECTORY, filename);
  writeFileSync(`${destination}.next`, contents, { mode: 0o600 });
  renameSync(`${destination}.next`, destination);
}

async function main() {
  const args = process.argv.slice(2);
  const scoreFlag = args.indexOf("--score");
  if (scoreFlag >= 0) {
    const [keyPath, scoresPath] = [args[scoreFlag + 1], args[scoreFlag + 2]];
    if (!keyPath || !scoresPath) fail("Usage: --score <key.local.json> <scores.local.json>");
    const result = scoreReview(
      JSON.parse(readFileSync(resolve(keyPath), "utf8")),
      JSON.parse(readFileSync(resolve(scoresPath), "utf8")),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const execute = args.includes("--execute");
  const keepReview = args.includes("--write-review");
  const runsFlag = args.indexOf("--runs");
  const runsPerVariant = runsFlag >= 0 ? Number(args[runsFlag + 1]) : DEFAULT_RUNS;
  if (!Number.isInteger(runsPerVariant) || runsPerVariant < 1 || runsPerVariant > MAX_RUNS)
    fail(`--runs must be an integer from 1 to ${MAX_RUNS}.`);
  const selectionFlag = args.indexOf("--fixtures");
  const selection =
    selectionFlag >= 0 ? parseFixtureSelection(args[selectionFlag + 1] ?? "") : undefined;
  const { duplicates, fixtures: fixtureSet } = readFixtureSet(SCREENSHOT_DIRECTORY, selection);
  // The fixture NUMBER is the identity: fixtureIndex = number - 1, so review ids read F<number>-<run>.
  // `position` (not the number) drives the medium/low ordering so it stays balanced for any selection.
  const fixtures = fixtureSet.map((fixture, position) => ({
    index: fixture.number - 1,
    position,
    screenshot: fixture.dataUrl,
  }));
  const implementation = await loadCompact();
  try {
    const sample = implementation.buildRequest({ screenshot: fixtures[0].screenshot, selectedTone: "playful" });
    const medium = withReasoningEffort(sample, "medium");
    const low = withReasoningEffort(sample, "low");
    assertRequestContract(medium, "medium");
    assertRequestContract(low, "low");
    assertOnlyEffortDiffers(medium, low);
    const planned = fixtures.flatMap((fixture) => plannedRuns(fixture.position, runsPerVariant));
    if (!execute) {
      const cost = planned.reduce((sum, variant) => sum + ESTIMATED_COST_PER_CALL[variant], 0);
      console.log(
        `Dry run ready: ${fixtures.length} unique fixtures (${fixtureSet.map((f) => f.number).join(", ")}) at original resolution, ` +
          `${planned.length} paid OpenRouter calls after --execute (${runsPerVariant} per variant per fixture), ` +
          `${fixtures.length * runsPerVariant} blinded pairs to review, estimated cost about $${cost.toFixed(2)} (estimate). ` +
          (duplicates.length
            ? `Skipped byte-identical duplicates: ${duplicates.map((d) => `${d.duplicate}=${d.of}`).join(", ")}. `
            : "") +
          `Requests differ only in reasoning.effort (medium vs low); Vertex-only, ZDR, model and JSON contract verified.`,
      );
      return;
    }
    if (process.env.BENCHMARK_CONFIRM_LIVE_API !== "yes")
      fail("Set BENCHMARK_CONFIRM_LIVE_API=yes immediately before using --execute.");
    const apiKey = stagingCredentials();
    const runs: Run[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const { index, position, screenshot } of fixtures) {
      for (const variant of plannedRuns(position, runsPerVariant)) {
        runs.push(
          await runOnce(implementation, apiKey, screenshot, variant, index, keepReview, (request) => {
            const adjusted = withReasoningEffort(request, variant);
            assertRequestContract(adjusted, variant);
            return adjusted;
          }),
        );
        writePrivate(
          `reasoning-effort-${timestamp}.partial.json`,
          `${JSON.stringify(buildReport(runs, fixtures.length, runsPerVariant), null, 2)}\n`,
        );
      }
    }
    const report = buildReport(runs, fixtures.length, runsPerVariant);
    writePrivate(`reasoning-effort-${timestamp}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writePrivate(`reasoning-effort-${timestamp}.md`, markdown(report));
    rmSync(join(RESULT_DIRECTORY, `reasoning-effort-${timestamp}.partial.json`), { force: true });
    if (keepReview) {
      const { key, review, scores } = buildBlindedReview(runs, Date.now() % 2 ** 31);
      writePrivate(`reasoning-effort-review-${timestamp}.local.md`, review);
      writePrivate(`reasoning-effort-scores-${timestamp}.local.json`, `${JSON.stringify(scores, null, 2)}\n`);
      writePrivate(`reasoning-effort-key-${timestamp}.local.json`, `${JSON.stringify(key, null, 2)}\n`);
    }
    console.log("A/B complete. Aggregate-only report saved in benchmarks/results/.");
  } finally {
    implementation.dispose();
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(`Benchmark stopped: ${error instanceof Error ? error.message : "Unknown setup error."}`);
    process.exitCode = 1;
  });
}
