const assert = require("node:assert/strict");
const test = require("node:test");

async function load() {
  const module = await import("./image-resolution-experiment.ts");
  return module.default ?? module;
}

test("word recall counts reference words as a multiset", async () => {
  const { wordRecall } = await load();
  assert.equal(wordRecall(["Hello there friend"], ["hello there friend"]), 1);
  assert.equal(wordRecall(["hello hello"], ["hello"]), 0.5);
  assert.equal(wordRecall(["a b"], []), null);
  assert.equal(wordRecall(["Hej med dig"], ["Hej", "dig"]), 2 / 3);
});
