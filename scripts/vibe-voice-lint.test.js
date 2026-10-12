const assert = require("node:assert/strict");
const test = require("node:test");

async function lint() {
  const module = await import("./vibe-voice-lint.ts");
  return module.default ?? module;
}

test("flags report-style openings and internal labels", async () => {
  const { voiceIssues } = await lint();
  assert.deepEqual(
    voiceIssues("Both agreed on drinks by the water, offered to buy rounds, and Alex is now asking when to meet up."),
    ["report_opening"],
  );
  assert.deepEqual(
    voiceIssues("Alex dropped a Pokémon Team Rocket reference that ME misunderstood as sports/gaming."),
    ["internal_label"],
  );
  assert.deepEqual(voiceIssues("The conversation shows mutual interest."), ["report_opening"]);
  assert.deepEqual(voiceIssues("ME and THEM are flirting."), ["internal_label", "report_opening"]);
  assert.deepEqual(voiceIssues("THEM sounds keen."), ["internal_label"]);
});

test("accepts natural direct address without requiring 'you' in every sentence", async () => {
  const { voiceIssues, addressesReader } = await lint();
  const good = [
    "You’re both clearly interested in meeting up. You’ve agreed on drinks by the water, and Alex is now asking when you’re free.",
    "Alex made a Pokémon Team Rocket reference that you initially misunderstood. They’re now clarifying what they meant.",
    "Both of you are keen on a drink.",
    "Ask me anything", // lower-case "me" is ordinary English
  ];
  for (const text of good) assert.deepEqual(voiceIssues(text), [], text);
  assert.equal(addressesReader(good[0]), true);
  assert.equal(addressesReader("Alex is keen and keeps asking questions."), false);
});

test("lints every user-facing vibe check text field and ignores the enums", async () => {
  const { lintVibeCheck } = await lint();
  assert.deepEqual(
    lintVibeCheck({
      conversationEnergy: "Warm and easy",
      risk: "ME could rush it",
      summary: "Both agreed to meet.",
      interestLevel: "High",
      bestTone: "playful",
    }),
    { risk: ["internal_label"], summary: ["report_opening"] },
  );
  assert.deepEqual(lintVibeCheck(null), {});
});
