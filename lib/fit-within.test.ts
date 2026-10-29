import assert from "node:assert/strict";
import test from "node:test";
import { fitWithin } from "./fit-within";

test("a tall screenshot is limited by the box height", () => {
  assert.deepEqual(fitWithin({ height: 350, width: 296 }, 1170 / 2532), {
    height: 350,
    width: (350 * 1170) / 2532,
  });
});

test("a wide screenshot is limited by the box width", () => {
  assert.deepEqual(fitWithin({ height: 350, width: 296 }, 2), {
    height: 148,
    width: 296,
  });
});

test("a matching ratio fills the box", () => {
  assert.deepEqual(fitWithin({ height: 200, width: 100 }, 0.5), {
    height: 200,
    width: 100,
  });
});

test("unknown ratio or empty box gives no size yet", () => {
  assert.equal(fitWithin({ height: 350, width: 296 }, null), null);
  assert.equal(fitWithin({ height: 0, width: 296 }, 0.5), null);
  assert.equal(fitWithin({ height: 350, width: 296 }, 0), null);
  assert.equal(fitWithin({ height: 350, width: 296 }, Number.NaN), null);
});
