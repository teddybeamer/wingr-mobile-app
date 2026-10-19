import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationFailureProperties,
  captureSafely,
} from "./conversation-diagnostics";

test("failure diagnostics contain only safe allowlisted metadata", () => {
  const properties = buildConversationFailureProperties({
    durationMs: 321,
    error: {
      id: 9,
      kind: "analysis",
      message: "PRIVATE screenshot text",
      code: "unusable_screenshot",
      errorCode: "unusable_screenshot",
      failureReason: "ownership_unclear",
      httpStatus: 422,
    },
    flow: "onboarding",
    outputContract: "contract",
  });
  assert.deepEqual(properties, {
    duration_ms: 321,
    error_code: "unusable_screenshot",
    failure_reason: "ownership_unclear",
    flow: "onboarding",
    http_status: 422,
    output_contract: "contract",
  });
  assert.ok(!JSON.stringify(properties).includes("PRIVATE"));
});

test("failure diagnostics omit unavailable fields and distinguish pro", () => {
  assert.deepEqual(
    buildConversationFailureProperties({
      durationMs: 5,
      error: { id: 1, kind: "replies", message: "safe" },
      flow: "pro",
      outputContract: "contract",
    }),
    {
      duration_ms: 5,
      flow: "pro",
      output_contract: "contract",
    },
  );
});

test("analytics failures never escape into the conversation flow", () => {
  let calls = 0;
  assert.doesNotThrow(() =>
    captureSafely(() => {
      calls++;
      throw new Error("PostHog unavailable");
    }, "screenshot_analysis_failed"),
  );
  assert.equal(calls, 1);
});
