import assert from "node:assert/strict";
import test from "node:test";
import {
  onboardingFlow,
  onboardingStepOrder,
} from "../onboarding/data/onboardingConfig";
import { onboardingContent } from "../onboarding/data/onboardingContent";

test("onboarding has no dedicated privacy step: consent is asked on Choose Screenshot", () => {
  assert.ok(!(onboardingStepOrder as string[]).includes("privacy"));
  assert.ok(!("privacy" in onboardingContent));
  assert.equal(
    onboardingStepOrder[onboardingStepOrder.indexOf("uploadScreenshot") - 1],
    "wouldYouSend",
  );
  assert.equal(
    onboardingStepOrder[onboardingStepOrder.indexOf("uploadScreenshot") + 1],
    "vibecheck",
  );
});

test("every onboarding step has content and appears once", () => {
  assert.equal(new Set(onboardingStepOrder).size, onboardingStepOrder.length);
  assert.equal(onboardingFlow.length, onboardingStepOrder.length);
  for (const step of onboardingFlow) assert.equal(step.content.id, step.id);
});
