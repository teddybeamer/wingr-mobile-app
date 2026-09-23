import assert from "node:assert/strict";
import test from "node:test";
import {
  getOnboardingAnalysisFailureAlert,
  isOnboardingDevicePreviewUsed,
  ONBOARDING_DEVICE_PREVIEW_USED_ALERT,
} from "./onboarding-analysis-error";

test("DeviceCheck preview-used is identified without matching account-scoped recovery", () => {
  assert.equal(
    isOnboardingDevicePreviewUsed({
      code: "onboarding_device_reply_used",
      message: "unused",
    }),
    true,
  );
  assert.equal(
    isOnboardingDevicePreviewUsed({
      code: "onboarding_reply_used",
      message: "unused",
    }),
    false,
  );
  assert.deepEqual(ONBOARDING_DEVICE_PREVIEW_USED_ALERT, {
    button: "Continue",
    message:
      "Your free WiNGR reply has already been used on this iPhone. Keep going to unlock more.",
    title: "Looks like we’ve met before 👀",
  });
});

test("generic onboarding analysis failures use concise retry copy", () => {
  assert.deepEqual(
    getOnboardingAnalysisFailureAlert({
      code: "invalid_output",
      message: "Wingr could not create a reliable reply. Please try again.",
    }),
    { title: "Something went wrong", message: "Please try again." },
  );
  assert.deepEqual(
    getOnboardingAnalysisFailureAlert({
      code: "provider",
      message: "Provider details are not actionable here.",
    }),
    { title: "Something went wrong", message: "Please try again." },
  );
});

test("screenshot-specific failures retain their useful explanation", () => {
  const message =
    "Wingr could not find a readable conversation to reply to. Try another screenshot.";
  assert.deepEqual(
    getOnboardingAnalysisFailureAlert({
      code: "unusable_screenshot",
      message,
    }),
    { title: "Could not read screenshot", message },
  );
});
