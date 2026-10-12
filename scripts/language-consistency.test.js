const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const module = await import("./language-consistency.ts");
  return module.default ?? module;
}

test("guesses English and Danish and stays unknown when unsure", async () => {
  const { guessLanguage } = await load();
  assert.equal(guessLanguage("You are clearly keen and they like the idea"), "en");
  assert.equal(guessLanguage("Han er meget interesseret og du kan godt lide det"), "da");
  assert.equal(guessLanguage("😉"), "unknown");
});

test("flags an English reply with a Danish vibe check, but not consistent output", async () => {
  const { hasMixedLanguages } = await load();
  assert.equal(
    hasMixedLanguages([
      "Haha oops, my brain went straight to Rocket League!",
      "Super flirtig og sjov banter, hvor I driller hinanden med en lille misforståelse.",
    ]),
    true,
  );
  assert.equal(hasMixedLanguages(["Det er en aftale!", "Han er interesseret og du kan godt lide det."]), false);
  assert.equal(hasMixedLanguages(["Sounds good 😉", "You are both keen on the idea."]), false);
});
