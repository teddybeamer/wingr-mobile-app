import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Offline latency reporting for staging experiments.
//
// This script never touches the network, reads no credentials and makes no
// generation request, so it cannot consume quota or incur provider cost. It
// reads files the operator exported from the STAGING project (Supabase
// function_logs) or recorded client-side, and extracts only a closed
// allowlist of numeric/enum fields. All other record content (prompts,
// screenshots, replies, user IDs, tokens) is discarded unread-by-design and
// can never reach the output.

export const STAGING_PROJECT_REF = "driytnlagwgzebnfdpcr";
export const LEASE_EVENT = "ai_generation_lease_release_latency";
export const PROVIDER_EVENT = "ai_generation_provider_latency";
export const STAGE_EVENT = "ai_generation_stage_latency";
export const STAGE_FIELDS = [
  "bodyMs",
  "entitlementWaitMs",
  "claimMs",
  "providerMs",
  "totalMs",
] as const;

const MAX_PLAUSIBLE_MS = 600_000;
const MIN_SAMPLES_FOR_P90 = 10;
const PROJECT_HOST = /\b([a-z0-9]{20})\.supabase\.(?:co|in)\b/gi;
const QUOTE = String.raw`[\\"']*`;

export type Outcome = "success" | "failure";
export type Generation = "onboarding" | "subscription";
export type LatencyEvent = {
  durationMs: number;
  generation: Generation | "unknown";
  outcome: Outcome | "unknown";
};
export type Stats = {
  count: number;
  maxMs: number;
  medianMs: number;
  minMs: number;
  p90Ms: number | null;
};

function field(text: string, name: string) {
  return new RegExp(`${QUOTE}${name}${QUOTE}\\s*[:=]\\s*${QUOTE}([A-Za-z0-9_.]+)`).exec(text)?.[1];
}

/** Extracts only allowlisted fields of one named telemetry event, or null. */
export function parseLatencyEvent(
  record: string,
  eventName: string,
): LatencyEvent | null {
  if (!record.includes(eventName)) return null;
  const duration = Number(field(record, "durationMs"));
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_PLAUSIBLE_MS)
    return null;
  const generation = field(record, "generation");
  const outcome = field(record, "outcome");
  return {
    durationMs: duration,
    generation:
      generation === "onboarding" || generation === "subscription"
        ? generation
        : "unknown",
    outcome: outcome === "success" || outcome === "failure" ? outcome : "unknown",
  };
}

function nearestRank(ordered: number[], percentile: number) {
  return ordered[Math.ceil(percentile * ordered.length) - 1];
}

export function summarizeDurations(values: number[]): Stats | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return {
    count: ordered.length,
    maxMs: ordered[ordered.length - 1],
    medianMs: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
    minMs: ordered[0],
    // A P90 from very few samples is just the maximum; do not present it.
    p90Ms: ordered.length >= MIN_SAMPLES_FOR_P90 ? nearestRank(ordered, 0.9) : null,
  };
}

// RFC 4180 parser: Supabase CSV exports put multi-line console output in quoted cells.
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (content[index + 1] === '"') (cell += '"'), index++;
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") (row.push(cell), (cell = ""));
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** Splits an export (CSV, JSON array/object, NDJSON or plain text) into record strings. */
export function exportRecords(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (/^"?event_message"?,/.test(trimmed)) {
    const [header, ...rows] = parseCsv(trimmed);
    const column = header.indexOf("event_message");
    // Keep only the message column; other columns are never read.
    return rows.map((row) => row[column] ?? "").filter(Boolean);
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { result?: unknown })?.result)
        ? (parsed as { result: unknown[] }).result
        : Array.isArray((parsed as { rows?: unknown })?.rows)
          ? (parsed as { rows: unknown[] }).rows
          : [parsed];
    return rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row)));
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean);
  }
}

/** Refuses exports that mention any Supabase project other than staging. */
export function assertStagingOnly(records: string[]) {
  for (const record of records) {
    for (const match of record.matchAll(PROJECT_HOST)) {
      if (match[1].toLowerCase() !== STAGING_PROJECT_REF)
        throw new Error(
          "Input references a Supabase project other than the staging project. Refusing to analyze it.",
        );
    }
  }
}

export type LogReport = {
  stages: Record<string, Stats>;
  // Same breakdown split by reasoning effort ("unspecified" for events from before the field existed).
  stagesByEffort: Record<string, Record<string, Stats>>;
  lease: Record<string, Stats>;
  provider: Record<string, Stats>;
  leaseShareOfProviderMedian: number | null;
};

function group(events: LatencyEvent[]) {
  const buckets = new Map<string, number[]>();
  for (const event of events) {
    for (const key of ["all", `${event.generation}/${event.outcome}`]) {
      buckets.set(key, [...(buckets.get(key) ?? []), event.durationMs]);
    }
  }
  return Object.fromEntries(
    [...buckets].map(([key, values]) => [key, summarizeDurations(values) as Stats]),
  );
}

export function reportFromLogs(records: string[]): LogReport {
  assertStagingOnly(records);
  const lease = records.flatMap((r) => parseLatencyEvent(r, LEASE_EVENT) ?? []);
  const provider = records.flatMap((r) => parseLatencyEvent(r, PROVIDER_EVENT) ?? []);
  // Per-stage breakdown of successful subscription generations only.
  const successfulStages = records.filter(
    (record) =>
      record.includes(STAGE_EVENT) &&
      field(record, "outcome") === "success" &&
      field(record, "generation") === "subscription",
  );
  const stageStats = (selected: string[]) => {
    const result: Record<string, Stats> = {};
    for (const name of STAGE_FIELDS) {
      const values = selected
        .map((record) => Number(field(record, name)))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= MAX_PLAUSIBLE_MS);
      const stats = summarizeDurations(values);
      if (stats) result[name] = stats;
    }
    return result;
  };
  const stages = stageStats(successfulStages);
  const efforts = [...new Set(successfulStages.map((record) => field(record, "reasoningEffort") ?? "unspecified"))];
  const stagesByEffort: Record<string, Record<string, Stats>> = {};
  if (efforts.length > 1 || (efforts.length === 1 && efforts[0] !== "unspecified"))
    for (const effort of efforts)
      stagesByEffort[effort] = stageStats(
        successfulStages.filter((record) => (field(record, "reasoningEffort") ?? "unspecified") === effort),
      );
  const leaseStats = group(lease);
  const providerStats = group(provider);
  const leaseMedian = leaseStats["subscription/success"]?.medianMs;
  const providerMedian = providerStats["subscription/success"]?.medianMs;
  return {
    stages,
    stagesByEffort,
    lease: leaseStats,
    provider: providerStats,
    leaseShareOfProviderMedian:
      leaseMedian !== undefined && providerMedian ? leaseMedian / providerMedian : null,
  };
}

/**
 * Client-side end-to-end samples: JSON array or NDJSON of
 * `{ "label": string, "durationMs": number }`. Only these two fields are read.
 */
export function reportFromSamples(records: string[]): Record<string, Stats> {
  const buckets = new Map<string, number[]>();
  for (const record of records) {
    let value: { durationMs?: unknown; label?: unknown };
    try {
      value = JSON.parse(record);
    } catch {
      continue;
    }
    const { durationMs, label } = value ?? {};
    if (
      typeof label !== "string" ||
      !/^[A-Za-z0-9_.-]{1,40}$/.test(label) ||
      typeof durationMs !== "number" ||
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      durationMs > MAX_PLAUSIBLE_MS
    )
      continue;
    buckets.set(label, [...(buckets.get(label) ?? []), durationMs]);
  }
  return Object.fromEntries(
    [...buckets].map(([label, values]) => [label, summarizeDurations(values) as Stats]),
  );
}

function formatStats(name: string, stats: Stats) {
  const p90 = stats.p90Ms === null ? `n/a (<${MIN_SAMPLES_FOR_P90} samples)` : `${stats.p90Ms} ms`;
  return `  ${name.padEnd(24)} n=${stats.count}  min=${stats.minMs}  median=${stats.medianMs} ms  p90=${p90}  max=${stats.maxMs}`;
}

export function formatReport(
  logs: LogReport | null,
  samples: Record<string, Stats> | null,
) {
  const lines: string[] = ["Staging latency report (aggregate only, offline)"];
  if (logs) {
    lines.push("", "Pipeline stages, successful subscription requests (ai_generation_stage_latency):");
    const stages = Object.entries(logs.stages);
    lines.push(...(stages.length ? stages.map(([k, v]) => formatStats(k, v)) : ["  no events found"]));
    for (const [effort, byStage] of Object.entries(logs.stagesByEffort)) {
      lines.push("", `Pipeline stages with reasoning effort "${effort}":`);
      lines.push(...Object.entries(byStage).map(([k, v]) => formatStats(k, v)));
    }
    lines.push("", "Lease release (ai_generation_lease_release_latency):");
    const lease = Object.entries(logs.lease);
    lines.push(...(lease.length ? lease.map(([k, v]) => formatStats(k, v)) : ["  no events found"]));
    lines.push("", "Provider (ai_generation_provider_latency):");
    const provider = Object.entries(logs.provider);
    lines.push(...(provider.length ? provider.map(([k, v]) => formatStats(k, v)) : ["  no events found"]));
    if (logs.leaseShareOfProviderMedian !== null)
      lines.push(
        "",
        `Lease release median is ${(logs.leaseShareOfProviderMedian * 100).toFixed(1)}% of provider median (subscription/success).`,
        "Expected saving from deferring the release is about the lease median, before network variance.",
      );
  }
  if (samples) {
    lines.push("", "Client end-to-end samples by label:");
    const entries = Object.entries(samples);
    lines.push(...(entries.length ? entries.map(([k, v]) => formatStats(k, v)) : ["  no valid samples"]));
    if (entries.length === 2) {
      const [[a, left], [b, right]] = entries;
      lines.push(
        `  median(${b}) - median(${a}) = ${right.medianMs - left.medianMs} ms (indicative only with small n)`,
      );
    }
  }
  return lines.join("\n");
}

function parseArguments(argv: string[]) {
  const logs: string[] = [];
  const samples: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const target = flag === "--logs" ? logs : flag === "--samples" ? samples : null;
    if (!target || !argv[index + 1])
      throw new Error("Usage: staging-latency-report --logs <export> [--samples <file>]");
    target.push(argv[++index]);
  }
  if (!logs.length && !samples.length)
    throw new Error("Usage: staging-latency-report --logs <export> [--samples <file>]");
  return { logs, samples };
}

const readRecords = (paths: string[]) =>
  paths.flatMap((path) => exportRecords(readFileSync(resolve(path), "utf8")));

function main() {
  const { logs, samples } = parseArguments(process.argv.slice(2));
  console.log(
    formatReport(
      logs.length ? reportFromLogs(readRecords(logs)) : null,
      samples.length ? reportFromSamples(readRecords(samples)) : null,
    ),
  );
}

const isDirectExecution =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`Report stopped: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
