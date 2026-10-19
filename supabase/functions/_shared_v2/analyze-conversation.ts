import {
  ConversationError,
  parseConversationRequest,
  toPublicConversationResult,
  UnusableScreenshotError,
} from "./conversation.ts";
import { handleCors } from "../_shared/cors.ts";
import { error, json } from "../_shared/http.ts";
import {
  analyzeWithGemini,
  DEFAULT_REASONING_EFFORT,
  type ProviderLatencyMeasurement,
} from "./openrouter.ts";
import { RevenueCatVerificationError } from "../_shared/revenuecat-entitlement.ts";
import type {
  RevenueCatAccess,
  RevenueCatEntitlementVerifier,
  RevenueCatSubscriptionPlan,
} from "../_shared/revenuecat-entitlement.ts";
import type { GenerationLease, UsageLimiter } from "../_shared/usage-limit.ts";
import type { OnboardingTrialManager as SharedOnboardingTrialManager } from "../_shared/onboarding-device-trial.ts";
import type { ConversationResult } from "./conversation.ts";

// The shared trial manager only encrypts and decrypts the validated result as
// opaque JSON, so it is reused unchanged; this restates its surface for the
// compact (v2) result, which has no `messages`.
type OnboardingTrial = Omit<
  Awaited<ReturnType<SharedOnboardingTrialManager["prepare"]>>,
  "complete" | "replay"
> & {
  complete(result: ConversationResult): Promise<ConversationResult>;
  replay?: ConversationResult;
};
type OnboardingTrialManager = {
  prepare(
    ...args: Parameters<SharedOnboardingTrialManager["prepare"]>
  ): Promise<OnboardingTrial>;
};

type GeminiOptions = NonNullable<Parameters<typeof analyzeWithGemini>[2]>;
export type ConversationHandlerOptions = Omit<
  GeminiOptions,
  "onProviderDispatch" | "onProviderLatency" | "signal"
> & {
  entitlementVerifier?: RevenueCatEntitlementVerifier;
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  onboardingTrialManager?: OnboardingTrialManager;
  usageLimiter?: UsageLimiter;
  // Schedules a non-critical task after the response has been handed back to
  // the caller. The production edge handler maps this to EdgeRuntime.waitUntil.
  defer?: (task: () => Promise<void>) => void;
};

function recordProviderLatency(
  generation: "onboarding" | "subscription",
  measurement: ProviderLatencyMeasurement,
) {
  // Fixed labels and a duration only. Never log image, transcript, reply,
  // prompt, user ID, authorization, API key, or provider response.
  console.info("[Wingr AI] provider latency", {
    durationMs: measurement.durationMs,
    event: "ai_generation_provider_latency",
    generation,
    outcome: measurement.outcome,
    outputContract: measurement.outputContract,
  });
}

function recordLeaseReleaseLatency({
  durationMs,
  generation,
  outcome,
}: {
  durationMs: number;
  generation: "onboarding" | "subscription";
  outcome: "success" | "failure";
}) {
  // Fixed labels and a duration only. Never log image, transcript, reply,
  // prompt, user ID, authorization, API key, or provider response.
  console.info("[Wingr AI] generation lease release latency", {
    durationMs,
    event: "ai_generation_lease_release_latency",
    generation,
    outcome,
  });
}

type StageTimings = {
  bodyMs: number;
  claimMs: number | null;
  entitlementWaitMs: number | null;
  providerMs: number | null;
  reasoningEffort: "low" | "medium";
};

function recordStageLatency({
  generation,
  outcome,
  timings,
  totalMs,
}: {
  generation: "onboarding" | "subscription";
  outcome: "success" | "failure";
  timings: StageTimings;
  totalMs: number;
}) {
  // Fixed labels and durations only. Never log image, transcript, reply,
  // prompt, user ID, authorization, API key, or provider response.
  console.info("[Wingr AI] generation stage latency", {
    ...timings,
    event: "ai_generation_stage_latency",
    generation,
    outcome,
    totalMs,
  });
}

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
      onProviderLatency: (measurement) =>
        recordProviderLatency("onboarding", measurement),
      signal: request.signal,
    });
    if (!result.replyable || !result.vibeCheck)
      throw new UnusableScreenshotError(
        result.replyable ? "unknown" : (result.failureReason ?? "unknown"),
      );
    return json(await trial.complete(toPublicConversationResult(result)));
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
    defer,
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

  const requestStartedAt = Date.now();

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
    const bodyMs = Date.now() - requestStartedAt;

    // Free onboarding generations are only available through the DeviceCheck
    // protected, one-per-device trial. There is deliberately no fallback to the
    // account-scoped onboarding claim: an anonymous account is free to create, so
    // it cannot guard a free generation. A missing token is rejected here, before
    // any entitlement lookup, usage claim or provider call.
    if (input.isOnboardingGeneration) {
      if (!input.deviceCheckToken)
        throw new ConversationError("invalid_request");
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
    let entitlementWaitMs: number | null = null;
    if (!input.isOnboardingGeneration) {
      if (!entitlementVerifier) {
        return accessError("subscription_verification_unavailable");
      }
      let access: RevenueCatAccess;
      const entitlementWaitStartedAt = Date.now();
      try {
        access = await entitlementVerifier.verifyAccess(
          authenticatedUserId,
          request.signal,
        );
        entitlementWaitMs = Date.now() - entitlementWaitStartedAt;
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
    let successfulSubscriptionResponse = false;
    const timings: StageTimings = {
      bodyMs,
      claimMs: null,
      entitlementWaitMs,
      providerMs: null,
      reasoningEffort:
        geminiOptions.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    };
    let succeeded = false;
    try {
      const result = await analyzeWithGemini(input, apiKey, {
        ...geminiOptions,
        signal: request.signal,
        onProviderLatency: (measurement) => {
          timings.providerMs = measurement.durationMs;
          recordProviderLatency(
            input.isOnboardingGeneration ? "onboarding" : "subscription",
            measurement,
          );
        },
        onProviderDispatch: async () => {
          const claimStartedAt = Date.now();
          try {
            if (!usageLimiter)
              throw new ConversationError("generation_protection_unavailable");
            // Onboarding returned above. Fail closed rather than ever claiming the
            // account-scoped onboarding allowance if that guard is changed.
            if (input.isOnboardingGeneration || !subscriptionPlan)
              throw new ConversationError("generation_protection_unavailable");
            generationLease.current = await usageLimiter.claim(
              authorization,
              subscriptionPlan,
            );
          } finally {
            timings.claimMs = Date.now() - claimStartedAt;
          }
        },
      });
      if (!result.replyable || !result.vibeCheck)
        throw new UnusableScreenshotError(
          result.replyable ? "unknown" : (result.failureReason ?? "unknown"),
        );
      // Keep onboarding cleanup on the existing synchronous path. The normal
      // subscription path may respond once its model result is fully validated.
      successfulSubscriptionResponse = !input.isOnboardingGeneration;
      succeeded = true;
      return json(toPublicConversationResult(result));
    } finally {
      recordStageLatency({
        generation: input.isOnboardingGeneration
          ? "onboarding"
          : "subscription",
        outcome: succeeded ? "success" : "failure",
        timings,
        totalMs: Date.now() - requestStartedAt,
      });
      if (generationLease.current && usageLimiter) {
        const leaseId = generationLease.current.leaseId;
        const releaseLease = async () => {
          const releaseStartedAt = Date.now();
          try {
            await usageLimiter.release(authorization, leaseId);
            recordLeaseReleaseLatency({
              durationMs: Date.now() - releaseStartedAt,
              generation: input.isOnboardingGeneration
                ? "onboarding"
                : "subscription",
              outcome: "success",
            });
          } catch {
            // The 60-second database TTL safely recovers a failed release.
            console.warn("[Wingr AI] generation lease release failed", {
              code: "generation_lease_release_failed",
            });
            recordLeaseReleaseLatency({
              durationMs: Date.now() - releaseStartedAt,
              generation: input.isOnboardingGeneration
                ? "onboarding"
                : "subscription",
              outcome: "failure",
            });
          }
        };
        if (successfulSubscriptionResponse && defer) {
          try {
            defer(releaseLease);
          } catch {
            // A missing background-task runtime must not leave a lease active.
            await releaseLease();
          }
        } else {
          await releaseLease();
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
      reason:
        safeError instanceof UnusableScreenshotError
          ? safeError.reason
          : undefined,
    };
    // Closed enum and numeric status only: never log a failure object or provider body.
    console.warn("[Wingr AI] request failed", diagnostics);
    const publicError = new ConversationError(
      safeError.kind,
      undefined,
      undefined,
      safeError.retryAt,
    );
    return json(
      {
        error: publicError.message,
        code: safeError.kind,
        reason:
          safeError instanceof UnusableScreenshotError
            ? safeError.reason
            : undefined,
        retryAt: safeError.retryAt,
      },
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
