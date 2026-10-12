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

test("the flirt-tone candidate changes only the tone paragraph and keeps every other rule", async () => {
  const candidates = await import("../benchmarks/prompt-candidates.ts");
  const production = await import("../supabase/functions/_shared/prompting.ts");
  const mod = candidates.default ?? candidates;
  const base = (production.default ?? production).SYSTEM_PROMPT;
  const flirt = mod.withFlirtTone(base);
  // Swapping the paragraph back must restore the production prompt exactly.
  assert.equal(flirt.replace(mod.FLIRT_TONE_PARAGRAPH, mod.TONE_PARAGRAPH), base);
  const missing = Object.entries(mod.PROMPT_RULE_CHECKS)
    .filter(([, pattern]) => !pattern.test(flirt))
    .map(([name]) => name);
  assert.deepEqual(missing, []);
  for (const [name, pattern] of Object.entries(mod.FLIRT_TONE_CHECKS)) {
    assert.ok(pattern.test(flirt), `${name} missing from candidate`);
    assert.equal(pattern.test(base), false, `${name} already in production`);
  }
  // Direct and casual tone definitions and the sensitivity rule are preserved verbatim.
  for (const kept of [
    "direct: clear, warm and confident.",
    "casualSmallTalk: relaxed, easygoing curiosity.",
    "do not force flirting into serious or sensitive exchanges.",
  ])
    assert.ok(flirt.includes(kept), kept);
  assert.ok(flirt.length - base.length < 700, "the candidate must stay a small change");
  assert.throws(() => mod.withFlirtTone("unrelated"), /no longer contains the tone paragraph/);
});

test("the flirt-tone candidate does not ask for pickup lines, compliments or long replies", async () => {
  const candidates = await import("../benchmarks/prompt-candidates.ts");
  const mod = candidates.default ?? candidates;
  assert.match(mod.FLIRT_TONE_PARAGRAPH, /no generic compliments, pickup lines, gushing or forced flirting/);
  assert.match(mod.FLIRT_TONE_PARAGRAPH, /one or two short sentences/i);
  assert.doesNotMatch(mod.FLIRT_TONE_PARAGRAPH, /compliment them|flirt hard|always flirt/i);
});
