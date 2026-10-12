const assert = require("node:assert/strict");
const test = require("node:test");

async function benchmarkModule() {
  const module = await import("./benchmark-ai-output.ts");
  return module.default ?? module;
}

test("benchmark alternates variants while preserving three runs per variant", async () => {
  const { plannedVariants } = await benchmarkModule();
  assert.deepEqual(plannedVariants(0), [
    "baseline",
    "compact",
    "baseline",
    "compact",
    "baseline",
    "compact",
  ]);
  assert.deepEqual(plannedVariants(1), [
    "compact",
    "baseline",
    "compact",
    "baseline",
    "compact",
    "baseline",
  ]);
});

test("benchmark requires the documented fixture names", async () => {
  const { validateFixtureNames } = await benchmarkModule();
  assert.doesNotThrow(() =>
    validateFixtureNames(["fixture-01.png", "fixture-02.png", "fixture-03.png"]),
  );
  assert.doesNotThrow(() =>
    validateFixtureNames(["fixture-01.PNG", "fixture-02.PNG", "fixture-03.PNG"]),
  );
  assert.throws(
    () => validateFixtureNames(["fixture-01.png", "fixture-02.png", "other.png"]),
    /fixture-01\.png, fixture-02\.png, and fixture-03\.png/,
  );
});

test("benchmark counts only the same completed responses production accepts", async () => {
  const { completedResponseContent } = await benchmarkModule();
  assert.equal(
    completedResponseContent({
      choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
    }),
    '{"ok":true}',
  );
  for (const payload of [
    { choices: [{ finish_reason: "length", message: { content: '{"ok":true}' } }] },
    { choices: [{ finish_reason: "stop", message: { content: '{"ok":true}', refusal: "no" } }] },
  ]) {
    assert.equal(completedResponseContent(payload), null);
  }
});

test("benchmark loads the compact implementation and pinned Git baseline without a network call", async () => {
  const { loadBaseline, loadCompact } = await benchmarkModule();
  const baseline = await loadBaseline();
  const compact = await loadCompact();
  try {
    const request = {
      screenshot: "data:image/png;base64,iVBORw0KGgo=",
      selectedTone: "playful",
    };
    const baselineSchema = baseline.buildRequest(request).response_format.json_schema.schema;
    const compactSchema = compact.buildRequest(request).response_format.json_schema.schema;
    assert.ok(Object.hasOwn(baselineSchema.properties, "messages"));
    assert.equal(Object.hasOwn(compactSchema.properties, "messages"), false);
  } finally {
    baseline.dispose();
    compact.dispose();
  }
});
