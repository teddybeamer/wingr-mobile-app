import {
  ConversationError,
  isUnusableScreenshotReason,
  parseConversationRequest,
  toPublicConversationResult,
  UnusableScreenshotError,
  type UnusableScreenshotReason,
} from "./conversation.ts";
import { handleCors } from "../_shared/cors.ts";
import { error, json } from "../_shared/http.ts";
import {
  analyzeWithGemini,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  type ProviderLatencyMeasurement,
} from "./openrouter.ts";
import { RevenueCatVerificationError } from "../_shared/revenuecat-entitlement.ts";
import type {
  RevenueCatAccess,
  RevenueCatEntitlementVerifier,
  RevenueCatSubscriptionPlan,
} from "../_shared/revenuecat-entitlement.ts";
import type {
  GenerationLease,
  SettlementOutcome,
  UsageLimiter,
} from "./usage-limit.ts";
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
    model: measurement.model,
    outcome: measurement.outcome,
    outputContract: measurement.outputContract,
    provider: measurement.provider,
  });
}

function recordSettlement({
  charged,
  durationMs,
  generation,
  result,
  settlement,
}: {
  charged: boolean | null;
  durationMs: number;
  generation: "onboarding" | "subscription";
  result: "applied" | "not_found" | "failed";
  settlement: SettlementOutcome;
}) {
  // Fixed labels, a boolean and a duration only. Never log image, transcript,
  // reply, prompt, user ID, lease ID, authorization, API key, or provider response.
  console.info("[Wingr AI] generation settlement", {
    charged,
    durationMs,
    event: "ai_generation_settlement",
    generation,
    result,
    settlement,
  });
}

// One outcome line per POST, written by handleConversationRequest once the
// response exists, so every exit is covered: success, validation, authentication,
// entitlement, quota, invalid screenshot and provider or infrastructure failure.
// Everything logged is a closed label, a status or a duration; the code and the
// reason are read back from the response only if they are known values.
type OutcomeStage =
  | "auth"
  | "body"
  | "entitlement"
  | "quota"
  | "provider"
  | "onboarding_trial"
  | "onboarding_replay"
  | "onboarding_finalize"
  | "done";
type OutcomeGeneration = "onboarding" | "subscription" | "unknown";
// Where the request has got to. Updated as it progresses and read once at the end.
type RequestTrace = { generation: OutcomeGeneration; stage: OutcomeStage };

const OUTCOME_CATEGORIES = {
  authentication_verification_unavailable: "technical",
  generation_in_progress: "quota",
  generation_protection_unavailable: "technical",
  invalid_output: "provider",
  invalid_request: "client_input",
  onboarding_device_reply_used: "quota",
  onboarding_reply_used: "quota",
  payload_too_large: "client_input",
  provider: "provider",
  subscription_required: "entitlement",
  subscription_verification_unavailable: "technical",
  timeout: "provider",
  unauthorized: "authentication",
  unusable_screenshot: "invalid_screenshot",
  usage_limit: "quota",
} as const;
type OutcomeCategory =
  | (typeof OUTCOME_CATEGORIES)[keyof typeof OUTCOME_CATEGORIES]
  | "ok";
type OutcomeCode = keyof typeof OUTCOME_CATEGORIES | "ok" | "unknown";

async function describeOutcome(response: Response): Promise<{
  category: OutcomeCategory;
  code: OutcomeCode;
  reason: UnusableScreenshotReason | null;
}> {
  if (response.ok) return { category: "ok", code: "ok", reason: null };
  let body: { code?: unknown; reason?: unknown } | null = null;
  try {
    body = await response.clone().json();
  } catch {
    // Not one of our JSON errors: reported as unknown below.
  }
  const code =
    typeof body?.code === "string" &&
    Object.hasOwn(OUTCOME_CATEGORIES, body.code)
      ? (body.code as keyof typeof OUTCOME_CATEGORIES)
      : null;
  if (!code) return { category: "technical", code: "unknown", reason: null };
  return {
    category: OUTCOME_CATEGORIES[code],
    code,
    reason:
      code === "unusable_screenshot" && isUnusableScreenshotReason(body?.reason)
        ? body.reason
        : null,
  };
}

async function recordRequestOutcome({
  durationMs,
  generation,
  response,
  stage,
}: {
  durationMs: number;
  generation: OutcomeGeneration;
  response: Response | null;
  stage: OutcomeStage;
}) {
  try {
    // A request that threw instead of answering is an internal error.
    const outcome = response
      ? await describeOutcome(response)
      : {
          category: "technical" as const,
          code: "unknown" as const,
          reason: null,
        };
    const fields = {
      category: outcome.category,
      code: outcome.code,
      durationMs,
      event: "ai_request_outcome",
      generation,
      reason: outcome.reason,
      stage,
      status: response?.status ?? 500,
    };
    // Always information for an answered request, whatever its outcome: failures
    // already raise their own warning (request failed, RevenueCat verification),
    // and `category` is what separates them here. An unhandled exception is an error.
    const log = response ? console.info : console.error;
    log("[Wingr AI] request outcome", fields);
  } catch {
    // Logging must never change the response.
  }
}

type StageTimings = {
  bodyMs: number;
  claimMs: number | null;
  entitlementWaitMs: number | null;
  model: string;
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
  trace,
}: {
  apiKey: string;
  authenticatedUserId: string;
  input: ReturnType<typeof parseConversationRequest>;
  manager: OnboardingTrialManager;
  options: GeminiOptions;
  request: Request;
  trace: RequestTrace;
}) {
  if (!input.deviceCheckToken || !input.onboardingTrialId)
    throw new ConversationError("generation_protection_unavailable");

  trace.stage = "onboarding_trial";
  const trial = await manager.prepare({
    deviceToken: input.deviceCheckToken,
    trialId: input.onboardingTrialId,
    userId: authenticatedUserId,
  });
  if (trial.kind === "replay") {
    trace.stage = "onboarding_replay";
    return json(trial.replay);
  }

  try {
    trace.stage = "provider";
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
    trace.stage = "onboarding_finalize";
    const completed = await trial.complete(toPublicConversationResult(result));
    trace.stage = "done";
    return json(completed);
  } catch (failure) {
    await trial.abandon();
    throw failure;
  }
}

async function handleRequest(
  request: Request,
  apiKey: string,
  options: ConversationHandlerOptions,
  trace: RequestTrace,
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
  trace.stage = "body";

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
    trace.generation = input.isOnboardingGeneration
      ? "onboarding"
      : "subscription";
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
        trace,
      });
    }

    let subscriptionPlan: RevenueCatSubscriptionPlan | null = null;
    let entitlementWaitMs: number | null = null;
    if (!input.isOnboardingGeneration) {
      trace.stage = "entitlement";
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
    // How this request is settled. Anything not explicitly decided below, which
    // covers every technical failure (timeout, provider error, invalid output,
    // protection error, client abort), stays "failure" and costs nothing.
    let settlement: SettlementOutcome = "failure";
    const timings: StageTimings = {
      bodyMs,
      claimMs: null,
      entitlementWaitMs,
      model: geminiOptions.model ?? DEFAULT_MODEL,
      providerMs: null,
      reasoningEffort:
        geminiOptions.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    };
    let succeeded = false;
    trace.stage = "provider";
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
            trace.stage = "quota";
            if (!usageLimiter)
              throw new ConversationError("generation_protection_unavailable");
            // Onboarding returned above. Fail closed rather than ever reserving
            // against the subscription allowance if that guard is changed.
            if (input.isOnboardingGeneration || !subscriptionPlan)
              throw new ConversationError("generation_protection_unavailable");
            // Reserving takes the lease and checks the plan limit; it charges
            // nothing. The charge, if any, happens when the request is settled.
            generationLease.current = await usageLimiter.reserve(
              authorization,
              subscriptionPlan,
            );
            trace.stage = "provider";
          } finally {
            timings.claimMs = Date.now() - claimStartedAt;
          }
        },
      });
      if (!result.replyable || !result.vibeCheck) {
        const reason = result.replyable
          ? "unknown"
          : (result.failureReason ?? "unknown");
        // Only an unreadable image or a missing conversation counts toward the
        // one-attempt-per-five-invalid-screenshots rule. Every other rejection
        // (ownership_unclear, no_replyable_message, unknown) is free.
        settlement =
          reason === "unreadable_image" || reason === "no_conversation"
            ? "invalid_screenshot"
            : "failure";
        throw new UnusableScreenshotError(reason);
      }
      settlement = "success";
      succeeded = true;
      trace.stage = "done";
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
        // Settled synchronously, exactly once, and never retried: the database
        // makes settlement idempotent per lease, but a retry here could only
        // matter by risking a second charge. If settlement fails after a valid
        // reply, the reply is still returned and the user is not charged; the
        // failure is logged for investigation. A failed settlement of a free
        // outcome costs nothing, and the 60-second lease TTL frees the user.
        const leaseId = generationLease.current.leaseId;
        const settleStartedAt = Date.now();
        const generation = input.isOnboardingGeneration
          ? "onboarding"
          : "subscription";
        try {
          const settled = await usageLimiter.settle(
            authorization,
            leaseId,
            settlement,
          );
          recordSettlement({
            charged: settled.charged,
            durationMs: Date.now() - settleStartedAt,
            generation,
            result: settled.applied ? "applied" : "not_found",
            settlement,
          });
        } catch {
          console.warn("[Wingr AI] generation settlement failed", {
            code: "generation_settlement_failed",
            settlement,
          });
          recordSettlement({
            charged: null,
            durationMs: Date.now() - settleStartedAt,
            generation,
            result: "failed",
            settlement,
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

export async function handleConversationRequest(
  request: Request,
  apiKey: string,
  options: ConversationHandlerOptions = {},
) {
  const trace: RequestTrace = { generation: "unknown", stage: "auth" };
  // Only a POST is a generation request: preflight and wrong-method answers
  // are not outcomes.
  if (request.method !== "POST")
    return handleRequest(request, apiKey, options, trace);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await handleRequest(request, apiKey, options, trace);
  } catch (failure) {
    await recordRequestOutcome({
      durationMs: Date.now() - startedAt,
      generation: trace.generation,
      response: null,
      stage: trace.stage,
    });
    throw failure;
  }
  await recordRequestOutcome({
    durationMs: Date.now() - startedAt,
    generation: trace.generation,
    response,
    stage: trace.stage,
  });
  return response;
}
