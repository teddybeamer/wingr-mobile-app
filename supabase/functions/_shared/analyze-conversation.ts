import {
  ConversationError,
  parseConversationRequest,
  MAX_SCREENSHOT_LENGTH,
  MAX_CONTEXT_LENGTH,
  MAX_PREVIOUS_WINGR_SUGGESTIONS,
  MAX_REPLY_LENGTH,
} from "./conversation.ts";
import { handleCors } from "./cors.ts";
import { error, json } from "./http.ts";
import { analyzeWithGemini } from "./openrouter.ts";
import type { UsageLimiter } from "./usage-limit.ts";

type GeminiOptions = NonNullable<Parameters<typeof analyzeWithGemini>[2]>;
export type ConversationHandlerOptions = Omit<
  GeminiOptions,
  "onProviderDispatch" | "signal"
> & {
  usageLimiter?: UsageLimiter;
};

export async function handleConversationRequest(
  request: Request,
  apiKey: string,
  options: ConversationHandlerOptions = {},
) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  if (request.method !== "POST") return error("Method not allowed.", 405);
  try {
    let value;
    try {
      const body = await request.text();
      if (
        body.length >
        MAX_SCREENSHOT_LENGTH +
          MAX_CONTEXT_LENGTH +
          MAX_PREVIOUS_WINGR_SUGGESTIONS * MAX_REPLY_LENGTH +
          1024
      )
        throw new Error();
      value = JSON.parse(body);
    } catch {
      throw new ConversationError("invalid_request");
    }
    const input = parseConversationRequest(value);
    const { usageLimiter, ...geminiOptions } = options;
    const result = await analyzeWithGemini(input, apiKey, {
      ...geminiOptions,
      signal: request.signal,
      onProviderDispatch: async () =>
        input.isOnboardingGeneration
          ? usageLimiter?.claimOnboarding(request.headers.get("authorization"))
          : usageLimiter?.claim(request.headers.get("authorization")),
    });
    if (!result.replyable || !result.messages.length || !result.vibeCheck)
      throw new ConversationError("unusable_screenshot");
    return json(result);
  } catch (failure) {
    const safeError =
      failure instanceof ConversationError
        ? failure
        : new ConversationError("provider");
    const status = {
      invalid_request: 400,
      invalid_output: 502,
      unusable_screenshot: 422,
      provider: 502,
      timeout: 504,
      usage_limit: 429,
      onboarding_reply_used: 409,
    }[safeError.kind];
    const diagnostics = {
      code: safeError.kind,
      providerStatus: safeError.providerStatus,
      providerReason: safeError.providerReason,
    };
    // Closed enum and numeric status only: never log a failure object or provider body.
    console.warn("[Wingr AI] request failed", diagnostics);
    return json({ error: safeError.message, ...diagnostics, retryAt: safeError.retryAt }, { status });
  }
}
