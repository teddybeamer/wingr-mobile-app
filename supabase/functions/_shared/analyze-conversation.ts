import {
  ConversationError,
  parseConversationRequest,
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

// A 10 MiB image expands to a 13,981,048-character data URL. 14 MiB leaves
// 692,492 bytes beyond the maximum valid screenshot-and-metadata payload.
export const MAX_REQUEST_BODY_BYTES = 14 * 1024 * 1024;

function contentLengthExceedsLimit(request: Request) {
  const contentLength = request.headers.get("content-length");
  return (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_REQUEST_BODY_BYTES
  );
}

async function readRequestBodyWithinLimit(request: Request): Promise<string> {
  if (contentLengthExceedsLimit(request))
    throw new ConversationError("payload_too_large");

  if (!request.body) return "";

  const reader = request.body.getReader();
  let buffer = new Uint8Array(0);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (value.byteLength > MAX_REQUEST_BODY_BYTES - length) {
        try {
          await reader.cancel();
        } catch {
          // The response remains a deterministic 413 even if the peer has
          // already closed the incoming stream.
        }
        throw new ConversationError("payload_too_large");
      }
      const requiredLength = length + value.byteLength;
      if (requiredLength > buffer.byteLength) {
        const capacity = Math.min(
          MAX_REQUEST_BODY_BYTES,
          Math.max(requiredLength, Math.max(64 * 1024, buffer.byteLength * 2)),
        );
        const next = new Uint8Array(capacity);
        next.set(buffer);
        buffer = next;
      }
      buffer.set(value, length);
      length = requiredLength;
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(
    buffer.subarray(0, length),
  );
}

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
      const body = await readRequestBodyWithinLimit(request);
      value = JSON.parse(body);
    } catch (failure) {
      if (failure instanceof ConversationError) throw failure;
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
      payload_too_large: 413,
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
