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

test("the fact-grounding candidate keeps every baseline rule and adds the new ones", async () => {
  const candidates = await import("../benchmarks/prompt-candidates.ts");
  const production = await import("../supabase/functions/_shared/prompting.ts");
  const mod = candidates.default ?? candidates;
  const base = (production.default ?? production).SYSTEM_PROMPT;
  const grounded = mod.withFactGrounding(base);
  const missing = Object.entries(mod.PROMPT_RULE_CHECKS)
    .filter(([, pattern]) => !pattern.test(grounded))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
  for (const [name, pattern] of Object.entries(mod.FACT_GROUNDING_CHECKS)) {
    assert.ok(pattern.test(grounded), `${name} missing from candidate`);
    assert.equal(pattern.test(base), false, `${name} already in production`);
  }
  assert.ok(!grounded.includes(mod.UNKNOWN_FACT_SENTENCE));
  assert.ok(grounded.length > base.length);
  assert.throws(() => mod.withFactGrounding("unrelated prompt"), /no longer contains/);
});

test("the unified-language candidate replaces only the language sentences and keeps the other rules", async () => {
  const candidates = await import("../benchmarks/prompt-candidates.ts");
  const production = await import("../supabase/functions/_shared/prompting.ts");
  const mod = candidates.default ?? candidates;
  const base = (production.default ?? production).SYSTEM_PROMPT;
  const unified = mod.withUnifiedLanguage(base);
  assert.equal(unified.replace(mod.UNIFIED_LANGUAGE_RULE, mod.LANGUAGE_SENTENCES), base);
  const missing = Object.entries(mod.PROMPT_RULE_CHECKS)
    .filter(([, pattern]) => !pattern.test(unified))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
  for (const [name, pattern] of Object.entries(mod.UNIFIED_LANGUAGE_CHECKS)) {
    assert.ok(pattern.test(unified), `${name} missing from candidate`);
    assert.equal(pattern.test(base), false, `${name} already in production`);
  }
  assert.ok(unified.includes("The reply itself stays in ME's own voice."));
  assert.ok(unified.includes("never write ME, THEM"));
  assert.throws(() => mod.withUnifiedLanguage("unrelated"), /no longer contains the language sentences/);
});
