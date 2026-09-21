import { ConversationError, parseConversationRequest } from "./conversation.ts";
import { handleCors } from "./cors.ts";
import { error, json } from "./http.ts";
import { analyzeWithGemini } from "./openrouter.ts";
import { RevenueCatVerificationError } from "./revenuecat-entitlement.ts";
import type {
  RevenueCatAccess,
  RevenueCatEntitlementVerifier,
  RevenueCatSubscriptionPlan,
} from "./revenuecat-entitlement.ts";
import type { GenerationLease, UsageLimiter } from "./usage-limit.ts";
import type { OnboardingTrialManager } from "./onboarding-device-trial.ts";

type GeminiOptions = NonNullable<Parameters<typeof analyzeWithGemini>[2]>;
export type ConversationHandlerOptions = Omit<
  GeminiOptions,
  "onProviderDispatch" | "signal"
> & {
  entitlementVerifier?: RevenueCatEntitlementVerifier;
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  onboardingTrialManager?: OnboardingTrialManager;
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

function retryAfterHeader(retryAt: string | undefined) {
  if (!retryAt) return undefined;
  const milliseconds = Date.parse(retryAt) - Date.now();
  if (!Number.isFinite(milliseconds)) return undefined;
  return { "retry-after": String(Math.max(1, Math.ceil(milliseconds / 1000))) };
}

async function handleDeviceCheckOnboardingRequest({
  apiKey,
  authenticatedUserId,
  input,
  manager,
  options,
  request,
}: {
  apiKey: string;
  authenticatedUserId: string;
  input: ReturnType<typeof parseConversationRequest>;
  manager: OnboardingTrialManager;
  options: GeminiOptions;
  request: Request;
}) {
  if (!input.deviceCheckToken || !input.onboardingTrialId)
    throw new ConversationError("generation_protection_unavailable");

  const trial = await manager.prepare({
    deviceToken: input.deviceCheckToken,
    trialId: input.onboardingTrialId,
    userId: authenticatedUserId,
  });
  if (trial.kind === "replay") return json(trial.replay);

  try {
    const result = await analyzeWithGemini(input, apiKey, {
      ...options,
      signal: request.signal,
    });
    if (!result.replyable || !result.messages.length || !result.vibeCheck)
      throw new ConversationError("unusable_screenshot");
    return json(await trial.complete(result));
  } catch (failure) {
    await trial.abandon();
    throw failure;
  }
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
    onboardingTrialManager,
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

    if (input.isOnboardingGeneration && input.deviceCheckToken) {
      if (!onboardingTrialManager)
        throw new ConversationError("generation_protection_unavailable");
      return await handleDeviceCheckOnboardingRequest({
        apiKey,
        authenticatedUserId,
        input,
        manager: onboardingTrialManager,
        options: geminiOptions,
        request,
      });
    }

    let subscriptionPlan: RevenueCatSubscriptionPlan | null = null;
    if (!input.isOnboardingGeneration) {
      if (!entitlementVerifier) {
        return accessError("subscription_verification_unavailable");
      }
      let access: RevenueCatAccess;
      try {
        access = await entitlementVerifier.verifyAccess(
          authenticatedUserId,
          request.signal,
        );
      } catch (failure) {
        const diagnostic =
          failure instanceof RevenueCatVerificationError
            ? {
                category: failure.category ?? "response_semantics",
                code: "revenuecat_verification_failed",
                operation: failure.operation ?? "configuration",
                upstreamErrorCode: failure.upstreamErrorCode,
                upstreamErrorType: failure.upstreamErrorType,
                upstreamStatus: failure.upstreamStatus,
              }
            : {
                category: "unexpected",
                code: "revenuecat_verification_failed",
                operation: "unknown",
              };
        // Closed enums and machine-readable upstream metadata only. Never log
        // the failure object, request, customer ID, authorization, or body.
        console.warn("[Wingr AI] RevenueCat verification failed", diagnostic);
        return accessError("subscription_verification_unavailable");
      }
      if (!access.hasActivePro) return accessError("subscription_required");
      subscriptionPlan = access.plan;
    }

    const authorization = request.headers.get("authorization");
    const generationLease: { current: GenerationLease | null } = {
      current: null,
    };
    try {
      const result = await analyzeWithGemini(input, apiKey, {
        ...geminiOptions,
        signal: request.signal,
        onProviderDispatch: async () => {
          if (!usageLimiter)
            throw new ConversationError("generation_protection_unavailable");
          if (input.isOnboardingGeneration) {
            generationLease.current =
              await usageLimiter.claimOnboarding(authorization);
          } else {
            if (!subscriptionPlan)
              throw new ConversationError("generation_protection_unavailable");
            generationLease.current = await usageLimiter.claim(
              authorization,
              subscriptionPlan,
            );
          }
        },
      });
      if (!result.replyable || !result.messages.length || !result.vibeCheck)
        throw new ConversationError("unusable_screenshot");
      return json(result);
    } finally {
      if (generationLease.current && usageLimiter) {
        try {
          await usageLimiter.release(
            authorization,
            generationLease.current.leaseId,
          );
        } catch {
          // The 60-second database TTL safely recovers a failed release.
          console.warn("[Wingr AI] generation lease release failed", {
            code: "generation_lease_release_failed",
          });
        }
      }
    }
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
      generation_in_progress: 429,
      generation_protection_unavailable: 503,
      usage_limit: 429,
      onboarding_reply_used: 409,
      onboarding_device_reply_used: 409,
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
      {
        status,
        headers:
          safeError.kind === "generation_in_progress"
            ? retryAfterHeader(safeError.retryAt)
            : undefined,
      },
    );
  }
}
