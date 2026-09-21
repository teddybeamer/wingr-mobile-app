import {
  ConversationError,
  MAX_PREVIOUS_WINGR_SUGGESTIONS,
  parseConversationRequest,
  parseConversationResult,
} from "../supabase/functions/_shared/conversation";
import type { OnboardingDeviceCheck } from "./devicecheck";
import type {
  AnalyzeScreenshotResult,
  ReplyTone,
  SuggestedReply,
} from "../types/wingr";
import { postJsonToWingrBackend } from "./wingr-api";

export function toAppResult(
  value: unknown,
  tone: ReplyTone,
  requestId: number,
): AnalyzeScreenshotResult {
  const result = parseConversationResult(value);
  if (!result.replyable || !result.vibeCheck || !result.messages.length)
    throw new ConversationError("unusable_screenshot");
  return {
    messages: result.messages,
    vibeCheck: result.vibeCheck,
    replies: result.replies.map((text, index) => ({
      id: `${requestId}-${index}`,
      tone,
      text,
    })),
  };
}

export function selectPreviousWingrSuggestions(
  replies: readonly SuggestedReply[],
) {
  return replies
    .slice(-MAX_PREVIOUS_WINGR_SUGGESTIONS)
    .map((reply) => reply.text);
}

export async function analyzeScreenshot({
  screenshotUri,
  selectedTone,
  extraContext,
  isOnboardingGeneration,
  onboardingDeviceCheck,
  previousWingrSuggestions,
  requestId,
  signal,
}: {
  screenshotUri: string;
  selectedTone: ReplyTone;
  extraContext?: string;
  isOnboardingGeneration?: boolean;
  onboardingDeviceCheck?: OnboardingDeviceCheck;
  previousWingrSuggestions?: string[];
  requestId: number;
  signal?: AbortSignal;
}): Promise<AnalyzeScreenshotResult> {
  const { readScreenshot } = await import("./screenshot");
  const screenshot = await readScreenshot(screenshotUri);
  if (signal?.aborted) throw new Error("Screenshot analysis cancelled.");
  const body = parseConversationRequest({
    screenshot,
    selectedTone,
    extraContext,
    ...(isOnboardingGeneration ? { isOnboardingGeneration: true } : {}),
    ...(onboardingDeviceCheck
      ? {
          deviceCheckToken: onboardingDeviceCheck.deviceCheckToken,
          onboardingTrialId: onboardingDeviceCheck.onboardingTrialId,
        }
      : {}),
    ...(previousWingrSuggestions?.length ? { previousWingrSuggestions } : {}),
  });
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[Wingr flow] backend request constructed", {
      isOnboardingGeneration: Boolean(isOnboardingGeneration),
      requestId,
    });
  }
  const result = await postJsonToWingrBackend<unknown>(
    "/ai-conversation",
    body,
    signal,
  );
  const appResult = toAppResult(result, selectedTone, requestId);
  if (onboardingDeviceCheck) {
    const { clearOnboardingDeviceCheckTrial } = await import("./devicecheck");
    await clearOnboardingDeviceCheckTrial();
  }
  return appResult;
}
