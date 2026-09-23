import type { ConversationErrorKind } from "../supabase/functions/_shared/conversation";

type OnboardingAnalysisError = {
  code?: ConversationErrorKind;
  message: string;
};

export const ONBOARDING_DEVICE_PREVIEW_USED_ALERT = {
  button: "Continue",
  message:
    "Your free WiNGR reply has already been used on this iPhone. Keep going to unlock more.",
  title: "Looks like we’ve met before 👀",
} as const;

export function isOnboardingDevicePreviewUsed(
  error: OnboardingAnalysisError,
) {
  return error.code === "onboarding_device_reply_used";
}

export function getOnboardingAnalysisFailureAlert(
  error: OnboardingAnalysisError,
) {
  switch (error.code) {
    case "invalid_request":
    case "payload_too_large":
    case "unusable_screenshot":
      return { title: "Could not read screenshot", message: error.message };
    case "generation_in_progress":
      return { title: "Something went wrong", message: error.message };
    case "usage_limit":
      return { title: "Reply limit reached", message: error.message };
    default:
      return { title: "Something went wrong", message: "Please try again." };
  }
}
