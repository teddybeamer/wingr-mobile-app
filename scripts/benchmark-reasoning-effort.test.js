const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const module = await import("./benchmark-reasoning-effort.ts");
  return module.default ?? module;
}

const provider = {
  allow_fallbacks: false,
  data_collection: "deny",
  only: ["google-vertex/global"],
  require_parameters: true,
  zdr: true,
};
const request = (effort = "medium", overrides = {}) => ({
  model: "google/gemini-3.8-flash",
  reasoning: { effort },
  provider,
  messages: ["same"],
  ...overrides,
});

test("requests may differ in reasoning effort only", async () => {
  const { assertOnlyEffortDiffers, withReasoningEffort } = await load();
  assert.doesNotThrow(() => assertOnlyEffortDiffers(request(), withReasoningEffort(request(), "low")));
  assert.throws(
    () => assertOnlyEffortDiffers(request(), request("low", { messages: ["other"] })),
    /more than reasoning effort/,
  );
});

test("the request contract guards effort, Vertex-only/ZDR routing and the model", async () => {
  const { assertRequestContract } = await load();
  assert.doesNotThrow(() => assertRequestContract(request("low"), "low"));
  assert.throws(() => assertRequestContract(request("medium"), "low"), /reasoning effort/);
  assert.throws(
    () => assertRequestContract(request("low", { provider: { ...provider, allow_fallbacks: true } }), "low"),
    /Vertex-only/,
  );
  assert.throws(
    () => assertRequestContract(request("low", { provider: { ...provider, zdr: false } }), "low"),
    /Vertex-only/,
  );
  assert.throws(() => assertRequestContract(request("low", { model: "other" }), "low"), /production Gemini model/);
});

test("planned runs alternate variants with equal counts", async () => {
  const { plannedRuns } = await load();
  assert.deepEqual(plannedRuns(0, 1), ["medium", "low"]);
  assert.deepEqual(plannedRuns(1, 1), ["low", "medium"]);
  for (const index of [0, 1, 2]) {
    const runs = plannedRuns(index, 3);
    assert.equal(runs.filter((v) => v === "low").length, 3);
    assert.equal(runs.filter((v) => v === "medium").length, 3);
  }
});

const run = (variant, fixtureIndex, text) => ({
  fixtureIndex,
  inputTokens: 2000,
  latencyMs: variant === "low" ? 5000 : 8000,
  outputTokens: 400,
  quality: { replyable: "true", interestLevel: "High", conversationEnergy: "x", bestTone: "playful", risk: "y", replyChars: 40 },
  reasoningTokens: variant === "low" ? 100 : 400,
  review: { reply: `${text} reply`, summary: `${text} summary` },
  status: "valid",
  variant,
});

test("blinded review hides the variant and the key unblinds scores without model text", async () => {
  const { buildBlindedReview, scoreReview } = await load();
  const runs = [run("medium", 0, "M1"), run("low", 0, "L1"), run("medium", 0, "M2"), run("low", 0, "L2")];
  const { key, review, scores } = buildBlindedReview(runs, 7);
  assert.deepEqual(Object.keys(key), ["F1-1", "F1-2"]);
  assert.equal(/\b(low|medium)\b/i.test(review.replace(/^#.*$/m, "").replace(/ownership.*$/gm, "")), false);
  for (const id of Object.keys(key)) {
    assert.deepEqual(Object.values(key[id]).sort(), ["low", "medium"]);
    scores[id] = {
      A: { ownership: key[id].A === "low" ? false : true, noInventedFacts: true, language: true, hook: 4, natural: 5 },
      B: { ownership: key[id].B === "low" ? false : true, noInventedFacts: true, language: true, hook: 2, natural: 3 },
      preferred: "A",
    };
  }
  const result = scoreReview(key, scores);
  assert.equal(result.low.hardFailures.ownership, 2);
  assert.equal(result.medium.hardFailures.ownership, undefined);
  assert.equal(result.low.outputs, 2);
  assert.equal(result.low.scaleMeans.hook + result.medium.scaleMeans.hook, 6);
  assert.equal(JSON.stringify(result).includes("summary"), false);
  assert.equal(result.preferences.low + result.preferences.medium, 2);
});

test("report compares latency and reasoning tokens and contains no model text", async () => {
  const { buildReport } = await load();
  const runs = [run("medium", 0, "SECRET"), run("low", 0, "SECRET"), run("medium", 0, "SECRET"), run("low", 0, "SECRET")];
  const report = buildReport(runs, 1, 2);
  assert.equal(JSON.stringify(report).includes("SECRET"), false);
  assert.equal(report.changePercentLowVsMedium.latencyMedian, -37.5);
  assert.equal(report.changePercentLowVsMedium.reasoningTokens, -75);
  assert.equal(report.quality.agreement.bestTone.across, 1);
});

test("dry run verifies the contract and makes no network request", async () => {
  const { execFileSync } = require("node:child_process");
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/benchmark-reasoning-effort.ts"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  }).toString();
  assert.match(output, /Dry run ready: \d+ unique fixtures .* at original resolution, \d+ paid OpenRouter calls/);
});

test("the report includes vibe voice shares without any text", async () => {
  const { buildReport } = await load();
  const quality = (voiceIssueFields, addressesReader) => ({
    replyable: "true", interestLevel: "High", conversationEnergy: "x", bestTone: "playful", risk: "y",
    replyChars: 40, voiceIssueFields, addressesReader,
  });
  const run = (variant, q) => ({ fixtureIndex: 0, inputTokens: 2000, latencyMs: 5000, outputTokens: 100, quality: q, reasoningTokens: 0, review: null, status: "valid", variant });
  const report = buildReport([run("medium", quality(1, false)), run("low", quality(0, true))], 1, 1);
  assert.equal(report.quality.voice.medium.outputsWithVoiceIssues, 1);
  assert.equal(report.quality.voice.low.addressesReaderShare, 1);
});

test("scoring unblinds vibe ratings and direct-address flags per variant", async () => {
  const { scoreReview } = await load();
  const key = { "F1-1": { A: "low", B: "medium" }, "F1-2": { A: "medium", B: "low" } };
  const score = (vibe, direct, report) => ({ ownership: true, noInventedFacts: true, language: true, hook: 5, natural: 5, flirt: 4, vibe, vibeDirect: direct, vibeReportTone: report });
  const result = scoreReview(key, {
    "F1-1": { A: score(5, true, false), B: score(3, false, true), preferred: "A" },
    "F1-2": { A: score(4, true, false), B: score(5, true, false), preferred: "B" },
  });
  assert.equal(result.low.scaleMeans.vibe, 5);
  assert.equal(result.medium.scaleMeans.vibe, 3.5);
  assert.equal(result.low.flagCounts.vibeDirect, 2);
  assert.equal(result.medium.flagCounts.vibeDirect, 1);
  assert.equal(result.medium.flagCounts.vibeReportTone, 1);
  assert.equal(result.low.flagCounts.vibeReportTone, undefined);
  assert.equal(result.preferences.low, 2);
});
