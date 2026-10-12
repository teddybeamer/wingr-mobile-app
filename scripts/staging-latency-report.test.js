const assert = require("node:assert/strict");
const test = require("node:test");

async function reportModule() {
  const module = await import("./staging-latency-report.ts");
  return module.default ?? module;
}

const lease = (durationMs, outcome = "success", generation = "subscription") =>
  JSON.stringify({
    event_message: `[Wingr AI] generation lease release latency { durationMs: ${durationMs}, event: 'ai_generation_lease_release_latency', generation: '${generation}', outcome: '${outcome}' }`,
    id: "row-1",
  });

test("extracts only allowlisted fields from log rows and ignores other content", async () => {
  const { parseLatencyEvent, LEASE_EVENT } = await reportModule();
  const secretRow = JSON.stringify({
    event_message: `ai_generation_lease_release_latency durationMs: 42 generation: subscription outcome: success reply: "SECRET REPLY" Bearer abc.def`,
  });
  const event = parseLatencyEvent(secretRow, LEASE_EVENT);
  assert.deepEqual(event, { durationMs: 42, generation: "subscription", outcome: "success" });
  assert.equal(JSON.stringify(event).includes("SECRET"), false);
  assert.equal(parseLatencyEvent("unrelated line durationMs: 5", LEASE_EVENT), null);
  assert.equal(
    parseLatencyEvent("ai_generation_lease_release_latency durationMs: -1", LEASE_EVENT),
    null,
  );
});

test("parses JSON-escaped nested log payloads", async () => {
  const { parseLatencyEvent, LEASE_EVENT } = await reportModule();
  const record = JSON.stringify({
    metadata: JSON.stringify({
      durationMs: 77,
      event: LEASE_EVENT,
      generation: "subscription",
      outcome: "failure",
    }),
  });
  assert.deepEqual(parseLatencyEvent(record, LEASE_EVENT), {
    durationMs: 77,
    generation: "subscription",
    outcome: "failure",
  });
});

test("computes median and nearest-rank P90, withholding P90 for tiny samples", async () => {
  const { summarizeDurations } = await reportModule();
  assert.equal(summarizeDurations([]), null);
  assert.deepEqual(summarizeDurations([30, 10, 20]), {
    count: 3,
    maxMs: 30,
    medianMs: 20,
    minMs: 10,
    p90Ms: null,
  });
  const ten = summarizeDurations([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ten.medianMs, 5.5);
  assert.equal(ten.p90Ms, 9);
});

test("reports lease latency from a log export and its share of provider latency", async () => {
  const { exportRecords, reportFromLogs, formatReport } = await reportModule();
  const provider = JSON.stringify({
    event_message:
      "ai_generation_provider_latency durationMs: 8000 generation: subscription outcome: success",
  });
  const records = exportRecords(
    JSON.stringify([JSON.parse(lease(100)), JSON.parse(lease(60)), JSON.parse(provider)]),
  );
  const report = reportFromLogs(records);
  assert.equal(report.lease["subscription/success"].count, 2);
  assert.equal(report.lease["subscription/success"].medianMs, 80);
  assert.equal(report.leaseShareOfProviderMedian, 0.01);
  const text = formatReport(report, null);
  assert.match(text, /median=80 ms/);
  assert.match(text, /n\/a/);
});

test("accepts NDJSON and Supabase-style result wrappers", async () => {
  const { exportRecords } = await reportModule();
  assert.equal(exportRecords(`${lease(1)}\n${lease(2)}\n`).length, 2);
  assert.equal(exportRecords(JSON.stringify({ result: [{ a: 1 }, { a: 2 }] })).length, 2);
  assert.deepEqual(exportRecords("  "), []);
});

test("refuses input that references a non-staging Supabase project", async () => {
  const { reportFromLogs, STAGING_PROJECT_REF } = await reportModule();
  assert.doesNotThrow(() =>
    reportFromLogs([`https://${STAGING_PROJECT_REF}.supabase.co/functions/v1/ai-conversation`]),
  );
  assert.throws(
    () => reportFromLogs(["https://abcdefghijklmnopqrst.supabase.co/functions/v1/x"]),
    /other than the staging project/,
  );
});

test("end-to-end samples group by label and drop invalid or extra fields", async () => {
  const { reportFromSamples, formatReport } = await reportModule();
  const rows = [
    ...[100, 110, 120].map((durationMs) => ({ label: "sync", durationMs, reply: "SECRET" })),
    ...[90, 95, 105].map((durationMs) => ({ label: "deferred", durationMs })),
    { label: "bad label!", durationMs: 1 },
    { label: "sync", durationMs: -5 },
    { label: "sync", durationMs: "7" },
  ].map((row) => JSON.stringify(row));
  const report = reportFromSamples(rows);
  assert.equal(report.sync.count, 3);
  assert.equal(report.deferred.medianMs, 95);
  const text = formatReport(null, report);
  assert.equal(text.includes("SECRET"), false);
  assert.match(text, /median\(deferred\) - median\(sync\) = -15 ms/);
});

test("parses Supabase CSV exports with multi-line quoted console messages", async () => {
  const { exportRecords, reportFromLogs } = await reportModule();
  const csv = [
    "event_message,event_type,execution_id,function_id,id,level,timestamp",
    "shutdown,Shutdown,a,b,c,log,1",
    '"[Wingr AI] generation lease release latency {',
    "  durationMs: 101,",
    '  event: ""ai_generation_lease_release_latency"",',
    '  generation: ""subscription"",',
    '  outcome: ""success""',
    '}',
    '",Log,a,b,c,info,2',
  ].join("\n");
  const records = exportRecords(csv);
  assert.equal(records.length, 2);
  const report = reportFromLogs(records);
  assert.equal(report.lease["subscription/success"].medianMs, 101);
});
