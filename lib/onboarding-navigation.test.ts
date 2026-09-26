import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceOnboardingNavigation,
  createOnboardingNavigation,
  goBackInOnboarding,
  goToOnboardingStep,
} from "../onboarding/navigation-history";

test("generated reply history returns from Testimonials to Your Reply", () => {
  let navigation = createOnboardingNavigation("uploadScreenshot");
  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "vibecheck");
  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "testimonials");
  assert.equal(goBackInOnboarding(navigation).currentStepId, "vibecheck");
});

test("generated reply path advances from Testimonials directly to Paywall and back", () => {
  let navigation = createOnboardingNavigation("uploadScreenshot");
  navigation = advanceOnboardingNavigation(navigation);
  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "testimonials");

  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "paywall");

  navigation = goBackInOnboarding(navigation);
  assert.equal(navigation.currentStepId, "testimonials");
  assert.equal(goBackInOnboarding(navigation).currentStepId, "vibecheck");
});

test("Skip history returns from Testimonials to Choose Screenshot", () => {
  let navigation = createOnboardingNavigation("uploadScreenshot");
  navigation = goToOnboardingStep(navigation, "testimonials");
  assert.equal(navigation.currentStepId, "testimonials");
  assert.equal(
    goBackInOnboarding(navigation).currentStepId,
    "uploadScreenshot",
  );
});

test("Skip history never visits Your Reply", () => {
  const navigation = goToOnboardingStep(
    createOnboardingNavigation("uploadScreenshot"),
    "testimonials",
  );
  assert.equal(navigation.history.includes("vibecheck"), false);
  assert.equal(navigation.currentStepId === "vibecheck", false);
});

test("Skip path advances from Testimonials directly to Paywall and back", () => {
  let navigation = goToOnboardingStep(
    createOnboardingNavigation("uploadScreenshot"),
    "testimonials",
  );

  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "paywall");

  navigation = goBackInOnboarding(navigation);
  assert.equal(navigation.currentStepId, "testimonials");
  assert.equal(
    goBackInOnboarding(navigation).currentStepId,
    "uploadScreenshot",
  );
});

test("DeviceCheck-blocked onboarding replaces the no-reply Vibe Check with Testimonials", () => {
  let navigation = createOnboardingNavigation("uploadScreenshot");
  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "vibecheck");

  navigation = goToOnboardingStep(navigation, "testimonials", {
    replaceCurrent: true,
  });
  assert.equal(navigation.currentStepId, "testimonials");
  assert.deepEqual(navigation.history, ["uploadScreenshot"]);
  assert.equal(navigation.history.includes("vibecheck"), false);
  assert.equal(goBackInOnboarding(navigation).currentStepId, "uploadScreenshot");

  navigation = advanceOnboardingNavigation(navigation);
  assert.equal(navigation.currentStepId, "paywall");
  assert.equal(goBackInOnboarding(navigation).currentStepId, "testimonials");
});

test("recovery cannot navigate back to Your Reply without a usable local reply", () => {
  const restoredClaim = createOnboardingNavigation("testimonials");
  assert.deepEqual(goBackInOnboarding(restoredClaim), restoredClaim);

  let defensiveRecovery = createOnboardingNavigation("uploadScreenshot");
  defensiveRecovery = advanceOnboardingNavigation(defensiveRecovery);
  assert.equal(defensiveRecovery.currentStepId, "vibecheck");
  defensiveRecovery = goToOnboardingStep(defensiveRecovery, "testimonials", {
    resetHistory: true,
  });
  assert.equal(defensiveRecovery.currentStepId, "testimonials");
  assert.deepEqual(defensiveRecovery.history, []);
  assert.deepEqual(goBackInOnboarding(defensiveRecovery), defensiveRecovery);
});
