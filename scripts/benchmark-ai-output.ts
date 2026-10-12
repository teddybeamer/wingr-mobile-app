#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(process.cwd());
const SCREENSHOT_DIRECTORY = join(ROOT, "benchmarks/screenshots");
const RESULT_DIRECTORY = join(ROOT, "benchmarks/results");
const BASELINE_FILE = join(ROOT, "benchmarks/baseline.json");
const STAGING_ENV_FILE = join(ROOT, "benchmarks/.env.staging.local");
const STAGING_PROJECT_REF = "driytnlagwgzebnfdpcr";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const RUNS_PER_VARIANT_PER_FIXTURE = 3;

type Variant = "baseline" | "compact";
type TokenCount = number | null;
type RunStatus = "valid" | "http_error" | "transport_error" | "validation_error";
type RunMeasurement = {
  latencyMs: number;
  outputTokens: TokenCount;
  reasoningTokens: TokenCount;
  status: RunStatus;
  variant: Variant;
};
type BuildRequest = (request: {
  screenshot: string;
  selectedTone: "playful";
}) => unknown;
type ParseResult = (value: unknown) => unknown;
type VariantImplementation = {
  buildRequest: BuildRequest;
  parseResult: ParseResult;
};
type Summary = {
  attemptedRuns: number;
  medianLatencyMs: number | null;
  p90LatencyMs: number | null;
  medianOutputTokens: number | null;
  medianReasoningTokens: number | null;
  requestErrors: number;
  successfulRuns: number;
  validationErrors: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function parseLocalEnv(contents: string) {
  const values: Record<string, string> = {};
  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) fail("Invalid local benchmark environment entry. Use KEY=value.");
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

function stagingCredentials() {
  if (!existsSync(STAGING_ENV_FILE))
    fail("Missing benchmarks/.env.staging.local.");
  const values = parseLocalEnv(readFileSync(STAGING_ENV_FILE, "utf8"));
  if (values.BENCHMARK_ENVIRONMENT !== "staging")
    fail("BENCHMARK_ENVIRONMENT must be staging.");
  if (values.BENCHMARK_SUPABASE_PROJECT_REF !== STAGING_PROJECT_REF)
    fail("BENCHMARK_SUPABASE_PROJECT_REF must be the known staging project.");
  const apiKey = values.BENCHMARK_OPENROUTER_API_KEY?.trim();
  if (!apiKey || apiKey === "PASTE_STAGING_OPENROUTER_KEY_HERE")
    fail("BENCHMARK_OPENROUTER_API_KEY must contain a staging-only key.");
  return apiKey;
}

function readFixtures() {
  if (!existsSync(SCREENSHOT_DIRECTORY))
    fail("Missing benchmarks/screenshots.");
  const mimeTypes: Record<string, string> = {
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const files = readdirSync(SCREENSHOT_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  if (files.length !== 3)
    fail("benchmarks/screenshots must contain exactly three non-hidden files.");
  return files.map((filename) => {
    const mimeType = mimeTypes[extname(filename).toLowerCase()];
    if (!mimeType) fail("Benchmark fixtures must be PNG, JPEG, or WebP.");
    const bytes = readFileSync(join(SCREENSHOT_DIRECTORY, filename));
    if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024)
      fail("Each benchmark fixture must be non-empty and at most 10 MiB.");
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  });
}

function baselineRevision() {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    fail("Unable to read benchmarks/baseline.json.");
  }
  const revision = (value as { baselineGitRef?: unknown }).baselineGitRef;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/i.test(revision))
    fail("benchmarks/baseline.json must contain a full Git revision.");
  return revision;
}

function sourceAtRevision(revision: string, relativePath: string) {
  try {
    return execFileSync("git", ["show", `${revision}:${relativePath}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
  } catch {
    fail("The pinned baseline Git revision is unavailable locally.");
  }
}

async function loadImplementation({
  sourceFor,
  verifyConversationSource,
}: {
  sourceFor: (filename: string) => string;
  verifyConversationSource: (source: string) => boolean;
}): Promise<VariantImplementation & { dispose: () => void }> {
  const directory = mkdtempSync(join(tmpdir(), "wingr-ai-baseline-"));
  try {
    for (const filename of ["conversation.ts", "prompting.ts", "openrouter.ts"]) {
      writeFileSync(join(directory, filename), sourceFor(filename), { mode: 0o600 });
    }
    const source = readFileSync(join(directory, "conversation.ts"), "utf8");
    if (!verifyConversationSource(source)) fail("AI output contract did not match the requested variant.");
    const openRouterModule = await import(
      `${pathToFileURL(join(directory, "openrouter.ts")).href}?benchmark=${Date.now()}`
    );
    const conversationModule = await import(
      `${pathToFileURL(join(directory, "conversation.ts")).href}?benchmark=${Date.now()}`
    );
    if (
      typeof openRouterModule.buildOpenRouterRequest !== "function" ||
      typeof conversationModule.parseConversationResult !== "function"
    ) {
      fail("Pinned baseline does not expose the expected AI implementation.");
    }
    return {
      buildRequest: openRouterModule.buildOpenRouterRequest as BuildRequest,
      dispose: () => rmSync(directory, { force: true, recursive: true }),
      parseResult: conversationModule.parseConversationResult as ParseResult,
    };
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
}

export async function loadBaseline() {
  const revision = baselineRevision();
  return loadImplementation({
    sourceFor: (filename) =>
      sourceAtRevision(revision, `supabase/functions/_shared/${filename}`),
    verifyConversationSource: (source) =>
      source.includes('required: ["messages", "replyable", "vibeCheck", "replies"]'),
  });
}

export async function loadCompact() {
  return loadImplementation({
    sourceFor: (filename) =>
      readFileSync(join(ROOT, "supabase/functions/_shared", filename), "utf8"),
    verifyConversationSource: (source) =>
      source.includes('required: ["replyable", "vibeCheck", "replies"]') &&
      !source.includes('required: ["messages", "replyable", "vibeCheck", "replies"]'),
  });
}

function nonNegativeInteger(value: unknown): TokenCount {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function responseTokens(payload: unknown) {
  const usage = (payload as {
    usage?: {
      completion_tokens?: unknown;
      reasoning_tokens?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
    };
  })?.usage;
  return {
    outputTokens: nonNegativeInteger(usage?.completion_tokens),
    reasoningTokens:
      nonNegativeInteger(usage?.reasoning_tokens) ??
      nonNegativeInteger(usage?.completion_tokens_details?.reasoning_tokens),
  };
}

async function runOnce({
  apiKey,
  implementation,
  screenshot,
  variant,
}: {
  apiKey: string;
  implementation: VariantImplementation;
  screenshot: string;
  variant: Variant;
}): Promise<RunMeasurement> {
  const request = implementation.buildRequest({ screenshot, selectedTone: "playful" });
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      body: JSON.stringify(request),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch {
    return {
      latencyMs: performance.now() - startedAt,
      outputTokens: null,
      reasoningTokens: null,
      status: "transport_error",
      variant,
    };
  }
  if (!response.ok)
    return {
      latencyMs: performance.now() - startedAt,
      outputTokens: null,
      reasoningTokens: null,
      status: "http_error",
      variant,
    };
  let payload: unknown;
  try {
    payload = await response.json();
    const content = (payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
    })?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("invalid response shape");
    implementation.parseResult(JSON.parse(content));
  } catch {
    return {
      latencyMs: performance.now() - startedAt,
      outputTokens: null,
      reasoningTokens: null,
      status: "validation_error",
      variant,
    };
  }
  const { outputTokens, reasoningTokens } = responseTokens(payload);
  return {
    latencyMs: performance.now() - startedAt,
    outputTokens,
    reasoningTokens,
    status: "valid",
    variant,
  };
}

function nearestRank(values: number[], percentile: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(percentile * ordered.length) - 1];
}

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function completeTokenMedian(values: TokenCount[], successfulRuns: number) {
  if (values.length !== successfulRuns || values.some((value) => value === null))
    return null;
  return median(values as number[]);
}

export function summarize(measurements: RunMeasurement[]): Summary {
  const valid = measurements.filter((measurement) => measurement.status === "valid");
  return {
    attemptedRuns: measurements.length,
    medianLatencyMs: median(valid.map((measurement) => measurement.latencyMs)),
    medianOutputTokens: completeTokenMedian(
      valid.map((measurement) => measurement.outputTokens),
      valid.length,
    ),
    medianReasoningTokens: completeTokenMedian(
      valid.map((measurement) => measurement.reasoningTokens),
      valid.length,
    ),
    p90LatencyMs: nearestRank(valid.map((measurement) => measurement.latencyMs), 0.9),
    requestErrors: measurements.filter(
      (measurement) =>
        measurement.status === "http_error" || measurement.status === "transport_error",
    ).length,
    successfulRuns: valid.length,
    validationErrors: measurements.filter(
      (measurement) => measurement.status === "validation_error",
    ).length,
  };
}

function savings(baseline: number | null, compact: number | null) {
  if (baseline === null || compact === null || baseline === 0) return null;
  const saved = baseline - compact;
  return {
    percent: Number(((saved / baseline) * 100).toFixed(2)),
    tokens: saved,
  };
}

function reportFor(measurements: RunMeasurement[]) {
  const baseline = summarize(measurements.filter(({ variant }) => variant === "baseline"));
  const compact = summarize(measurements.filter(({ variant }) => variant === "compact"));
  return {
    baselineGitRef: baselineRevision(),
    compactOutputContract: "vibe_reply_no_transcript_v1",
    fixtureCount: 3,
    latencyDefinition:
      "Client-side wall-clock time from OpenRouter fetch dispatch until the complete non-streaming response is parsed.",
    metricDefinition:
      "Token savings compare per-variant median provider usage. Missing provider token fields remain null.",
    runsPerVariantPerFixture: RUNS_PER_VARIANT_PER_FIXTURE,
    summaries: { baseline, compact },
    tokenSavings: {
      outputTokens: savings(baseline.medianOutputTokens, compact.medianOutputTokens),
      reasoningTokens: savings(
        baseline.medianReasoningTokens,
        compact.medianReasoningTokens,
      ),
    },
  };
}

function markdownReport(report: ReturnType<typeof reportFor>) {
  const row = (name: string, baseline: unknown, compact: unknown) =>
    `| ${name} | ${String(baseline)} | ${String(compact)} |`;
  const { baseline, compact } = report.summaries;
  return `# WiNGR compact-output benchmark\n\n` +
    `Aggregate-only report. No screenshots, prompts, AI output, credentials, or user identifiers are included.\n\n` +
    `- Baseline Git revision: \`${report.baselineGitRef}\`\n` +
    `- Runs: ${report.fixtureCount} fixtures × ${report.runsPerVariantPerFixture} runs per variant\n` +
    `- Latency: ${report.latencyDefinition}\n\n` +
    `| Metric | Baseline | Compact |\n| --- | ---: | ---: |\n` +
    [
      row("Valid runs", baseline.successfulRuns, compact.successfulRuns),
      row("Validation errors", baseline.validationErrors, compact.validationErrors),
      row("Request errors", baseline.requestErrors, compact.requestErrors),
      row("Median latency (ms)", baseline.medianLatencyMs, compact.medianLatencyMs),
      row("P90 latency (ms)", baseline.p90LatencyMs, compact.p90LatencyMs),
      row("Median output tokens", baseline.medianOutputTokens, compact.medianOutputTokens),
      row("Median reasoning tokens", baseline.medianReasoningTokens, compact.medianReasoningTokens),
    ].join("\n") +
    `\n\n- Output-token savings: ${JSON.stringify(report.tokenSavings.outputTokens)}\n` +
    `- Reasoning-token savings: ${JSON.stringify(report.tokenSavings.reasoningTokens)}\n`;
}

export function plannedVariants(fixtureIndex: number) {
  const first: Variant = fixtureIndex % 2 === 0 ? "baseline" : "compact";
  const second: Variant = first === "baseline" ? "compact" : "baseline";
  return Array.from({ length: RUNS_PER_VARIANT_PER_FIXTURE }, () => [first, second]).flat();
}

async function main() {
  const execute = process.argv.slice(2).includes("--execute");
  const fixtures = readFixtures();
  const baseline = await loadBaseline();
  const compact = await loadCompact();
  try {
    const plannedRuns = fixtures.flatMap((_, index) => plannedVariants(index));
    if (!execute) {
      console.log(
        `Dry run ready: ${fixtures.length} private fixtures, ${plannedRuns.length} direct OpenRouter calls after --execute.`,
      );
      return;
    }
    if (process.env.BENCHMARK_CONFIRM_LIVE_API !== "yes")
      fail("Set BENCHMARK_CONFIRM_LIVE_API=yes immediately before using --execute.");
    const apiKey = stagingCredentials();
    const implementations: Record<Variant, VariantImplementation> = {
      baseline,
      compact,
    };
    const measurements: RunMeasurement[] = [];
    for (const [fixtureIndex, screenshot] of fixtures.entries()) {
      for (const variant of plannedVariants(fixtureIndex)) {
        measurements.push(
          await runOnce({
            apiKey,
            implementation: implementations[variant],
            screenshot,
            variant,
          }),
        );
      }
    }
    const report = reportFor(measurements);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    mkdirSync(RESULT_DIRECTORY, { recursive: true });
    writeFileSync(join(RESULT_DIRECTORY, `compact-output-${timestamp}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(RESULT_DIRECTORY, `compact-output-${timestamp}.md`), markdownReport(report), { mode: 0o600 });
    console.log("Benchmark complete. Aggregate-only report saved in benchmarks/results/.");
  } finally {
    baseline.dispose();
    compact.dispose();
  }
}

const isDirectExecution =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown benchmark setup error.";
    console.error(`Benchmark stopped: ${message}`);
    process.exitCode = 1;
  });
}
