const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const module = await import("./benchmark-image-resolution.ts");
  return module.default ?? module;
}

test("planned runs alternate variants per fixture and keep equal counts", async () => {
  const { plannedRuns } = await load();
  assert.deepEqual(plannedRuns(0, 2), ["original", "resized1280", "original", "resized1280"]);
  assert.deepEqual(plannedRuns(1, 1), ["resized1280", "original"]);
  for (const index of [0, 1, 2]) {
    const runs = plannedRuns(index, 3);
    assert.equal(runs.filter((v) => v === "original").length, 3);
    assert.equal(runs.filter((v) => v === "resized1280").length, 3);
  }
});

test("agreement measures within-group and across-group equality", async () => {
  const { agreement } = await load();
  assert.equal(agreement(["a", "a", "a"]), 1);
  assert.equal(agreement(["a", "a", "b"]), 1 / 3);
  assert.equal(agreement(["a", "b"], ["a", "a"]), 0.5);
  assert.equal(agreement(["a"]), null);
});

test("qualityOf keeps only closed enum fields and a reply length", async () => {
  const { qualityOf } = await load();
  const quality = qualityOf({
    replyable: true,
    replies: ["hello there"],
    vibeCheck: { interestLevel: "High", conversationEnergy: "Warm", bestTone: "playful", risk: "Low", summary: "SECRET" },
  });
  assert.equal(JSON.stringify(quality).includes("SECRET"), false);
  assert.equal(JSON.stringify(quality).includes("hello there"), false);
  assert.equal(quality.replyChars, 11);
  assert.equal(quality.interestLevel, "High");
  assert.equal(qualityOf({ replyable: false, replies: [], vibeCheck: null }).risk, "none");
  assert.equal(qualityOf(null), null);
});

test("the report is aggregate-only and compares the two variants", async () => {
  const { buildReport } = await load();
  const run = (variant, fixtureIndex, latencyMs, inputTokens) => ({
    fixtureIndex,
    inputTokens,
    latencyMs,
    outputTokens: 600,
    quality: { replyable: "true", interestLevel: "High", conversationEnergy: "Warm", bestTone: "playful", risk: "Low", replyChars: 40 },
    reasoningTokens: 400,
    review: { reply: "SECRET REPLY", summary: "SECRET SUMMARY" },
    status: "valid",
    variant,
  });
  const report = buildReport(
    [run("original", 0, 9000, 2000), run("resized1280", 0, 8100, 1500), run("original", 0, 9200, 2000), run("resized1280", 0, 8300, 1500)],
    1,
    2,
    { original: 500, resized1280: 250 },
  );
  assert.equal(JSON.stringify(report).includes("SECRET"), false);
  assert.equal(report.changePercent.inputTokens, -25);
  assert.equal(report.summaries.original.medianLatencyMs, 9100);
  assert.equal(report.quality.fields.bestTone.acrossVariants, 1);
});

test("dry run makes no network request and needs no credentials", async () => {
  const { execFileSync } = require("node:child_process");
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/benchmark-image-resolution.ts"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  }).toString();
  assert.match(output, /Dry run ready: 3 fixtures, 18 paid OpenRouter calls after --execute/);
});
