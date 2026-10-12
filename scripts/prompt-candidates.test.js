const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const candidates = await import("../benchmarks/prompt-candidates.ts");
  const production = await import("../supabase/functions/_shared/prompting.ts");
  return {
    ...(candidates.default ?? candidates),
    SYSTEM_PROMPT: (production.default ?? production).SYSTEM_PROMPT,
  };
}

test("the rule checklist matches the current production prompt", async () => {
  const { PROMPT_RULE_CHECKS, SYSTEM_PROMPT } = await load();
  const missing = Object.entries(PROMPT_RULE_CHECKS)
    .filter(([, pattern]) => !pattern.test(SYSTEM_PROMPT))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
});

test("the lean candidate keeps every checked rule and is shorter", async () => {
  const { LEAN_SYSTEM_PROMPT, PROMPT_RULE_CHECKS, SYSTEM_PROMPT } = await load();
  const missing = Object.entries(PROMPT_RULE_CHECKS)
    .filter(([, pattern]) => !pattern.test(LEAN_SYSTEM_PROMPT))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
  assert.ok(LEAN_SYSTEM_PROMPT.length < SYSTEM_PROMPT.length);
});

test("the lean candidate does not change the closed output vocabulary", async () => {
  const { LEAN_SYSTEM_PROMPT, SYSTEM_PROMPT } = await load();
  for (const term of ["playful", "direct", "casualSmallTalk", "replyable=false", "selectedTone"]) {
    assert.equal(LEAN_SYSTEM_PROMPT.includes(term), SYSTEM_PROMPT.includes(term), term);
  }
});
