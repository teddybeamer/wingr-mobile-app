import assert from "node:assert/strict";
import test from "node:test";
import { getBreakpoints } from "./responsive";

test("standard iPhones are not compact", () => {
  assert.deepEqual(getBreakpoints(390, 844), {
    compactHeight: false,
    compactWidth: false,
  });
  assert.deepEqual(getBreakpoints(360, 780), {
    compactHeight: false,
    compactWidth: false,
  });
});

test("320 pt wide devices are compact in width", () => {
  assert.equal(getBreakpoints(320, 568).compactWidth, true);
  assert.equal(getBreakpoints(359, 800).compactWidth, true);
});

test("iPhone SE class heights are compact in height", () => {
  assert.equal(getBreakpoints(375, 667).compactHeight, true);
  assert.equal(getBreakpoints(375, 667).compactWidth, false);
});

test("invalid dimensions never trigger a breakpoint", () => {
  assert.deepEqual(getBreakpoints(0, 0), {
    compactHeight: false,
    compactWidth: false,
  });
});
