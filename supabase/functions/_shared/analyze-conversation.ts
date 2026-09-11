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
import type { RevenueCatEntitlementVerifier } from "./revenuecat-entitlement.ts";
import type { UsageLimiter } from "./usage-limit.ts";

type GeminiOptions = NonNullable<Parameters<typeof analyzeWithGemini>[2]>;
export type ConversationHandlerOptions = Omit<
  GeminiOptions,
  "onProviderDispatch" | "signal"
> & {
  entitlementVerifier?: RevenueCatEntitlementVerifier;
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  usageLimiter?: UsageLimiter;
};

const ACCESS_ERRORS = {
  authentication_verification_unavailable: {
    message: "Wingr could not verify your account right now. Please try again.",
    status: 503,
  },
  subscription_required: {
    message: "An active WiNGR Pro subscription is required.",
    status: 403,
  },
  subscription_verification_unavailable: {
    message:
      "Wingr could not verify your subscription right now. Please try again.",
    status: 503,
  },
  unauthorized: {
    message: "Authentication is required.",
    status: 401,
  },
} as const;

function accessError(code: keyof typeof ACCESS_ERRORS) {
  const failure = ACCESS_ERRORS[code];
  return json({ code, error: failure.message }, { status: failure.status });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function handleConversationRequest(
  request: Request,
  apiKey: string,
  options: ConversationHandlerOptions = {},
) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  if (request.method !== "POST") return error("Method not allowed.", 405);

  const {
    entitlementVerifier,
    getVerifiedUserId,
    usageLimiter,
    ...geminiOptions
  } = options;

  const accessToken = bearerToken(request);
  if (!accessToken) return accessError("unauthorized");
  if (!getVerifiedUserId) {
    return accessError("authentication_verification_unavailable");
  }
  let userId: string | null;
  try {
    userId = await getVerifiedUserId(accessToken);
  } catch {
    return accessError("authentication_verification_unavailable");
  }
  const authenticatedUserId = userId?.trim() ?? "";
  if (!isUuid(authenticatedUserId)) return accessError("unauthorized");

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

    if (!input.isOnboardingGeneration) {
      if (!entitlementVerifier) {
        return accessError("subscription_verification_unavailable");
      }
      let hasActivePro: boolean;
      try {
        hasActivePro = await entitlementVerifier.hasActivePro(
          authenticatedUserId,
          request.signal,
        );
      } catch {
        return accessError("subscription_verification_unavailable");
      }
      if (!hasActivePro) return accessError("subscription_required");
    }

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
    return json(
      { error: safeError.message, ...diagnostics, retryAt: safeError.retryAt },
      { status },
    );
  }
}
