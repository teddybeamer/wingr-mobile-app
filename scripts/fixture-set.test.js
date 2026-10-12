const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

async function load() {
  const module = await import("./fixture-set.ts");
  return module.default ?? module;
}

const png = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);

function directory(files) {
  const dir = mkdtempSync(join(tmpdir(), "fixture-set-test-"));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return dir;
}

test("parses fixture selections and rejects malformed ones", async () => {
  const { parseFixtureSelection } = await load();
  assert.deepEqual(parseFixtureSelection("4, 06,4,10"), [4, 6, 10]);
  assert.throws(() => parseFixtureSelection("a"), /--fixtures/);
  assert.throws(() => parseFixtureSelection("0"), /--fixtures/);
});

test("drops byte-identical duplicates and reports them", async () => {
  const { readFixtureSet } = await load();
  const dir = directory({ "fixture-01.PNG": png("a"), "fixture-02.PNG": png("b"), "fixture-03.PNG": png("a") });
  try {
    const { duplicates, fixtures } = readFixtureSet(dir);
    assert.deepEqual(fixtures.map((f) => f.number), [1, 2]);
    assert.deepEqual(duplicates, [{ duplicate: "fixture-03.PNG", of: "fixture-01.PNG" }]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("selection keeps only requested unique fixtures and fails on duplicates or gaps", async () => {
  const { readFixtureSet } = await load();
  const dir = directory({ "fixture-01.PNG": png("a"), "fixture-02.PNG": png("b"), "fixture-03.PNG": png("a") });
  try {
    assert.deepEqual(readFixtureSet(dir, [2]).fixtures.map((f) => f.number), [2]);
    assert.throws(() => readFixtureSet(dir, [3]), /not available/);
    assert.throws(() => readFixtureSet(dir, [9]), /not available/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("rejects bad names and bytes that do not match the file type", async () => {
  const { readFixtureSet } = await load();
  const badName = directory({ "photo.png": png("a") });
  const badBytes = directory({ "fixture-01.png": Buffer.from("not an image") });
  try {
    assert.throws(() => readFixtureSet(badName), /named fixture-NN/);
    assert.throws(() => readFixtureSet(badBytes), /bytes must match/);
  } finally {
    rmSync(badName, { force: true, recursive: true });
    rmSync(badBytes, { force: true, recursive: true });
  }
});
