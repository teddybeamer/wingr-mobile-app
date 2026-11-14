import {
  ConversationError,
  isUnusableScreenshotReason,
  parseConversationRequest,
  toPublicConversationResult,
  UnusableScreenshotError,
  type UnusableScreenshotReason,
} from "./conversation.ts";
import {
  CONSENT_COVERED_PROVIDERS,
  type ConsentVerifier,
} from "../_shared/ai-consent.ts";
import { handleCors } from "../_shared/cors.ts";
import { error, json } from "../_shared/http.ts";
import {
  authenticate,
  checkConsent,
  checkProAccess,
  generationErrorResponse,
  readJsonBody,
  recordProviderLatency,
  settleGeneration,
} from "./ai-request.ts";
import {
  analyzeWithGemini,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  providerForModel,
  type ProviderLatencyMeasurement,
} from "./openrouter.ts";
import type {
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
  consentVerifier?: ConsentVerifier;
  // Providers the consent text names. Only tests set this (to exercise another
  // preset); production always uses the list in _shared/ai-consent.ts.
  consentCoveredProviders?: readonly string[];
  entitlementVerifier?: RevenueCatEntitlementVerifier;
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  onboardingTrialManager?: OnboardingTrialManager;
  usageLimiter?: UsageLimiter;
};

// One outcome line per POST, written by handleConversationRequest once the
// response exists, so every exit is covered: success, validation, authentication,
// entitlement, quota, invalid screenshot and provider or infrastructure failure.
// Everything logged is a closed label, a status or a duration; the code and the
// reason are read back from the response only if they are known values.
type OutcomeStage =
  | "auth"
  | "consent"
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
  ai_consent_required: "consent",
  ai_provider_not_disclosed: "technical",
  authentication_verification_unavailable: "technical",
  generation_in_progress: "quota",
  consent_verification_unavailable: "technical",
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

export { MAX_REQUEST_BODY_BYTES } from "./ai-request.ts";

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
    consentCoveredProviders = CONSENT_COVERED_PROVIDERS,
    consentVerifier,
    entitlementVerifier,
    getVerifiedUserId,
    onboardingTrialManager,
    usageLimiter,
    ...geminiOptions
  } = options;

  const authentication = await authenticate(request, getVerifiedUserId);
  if ("response" in authentication) return authentication.response;
  const authenticatedUserId = authentication.userId;

  // Consent comes before anything that could spend or send something: it runs
  // before the body is read, the onboarding DeviceCheck trial is prepared, the
  // entitlement is looked up, a quota lease is taken, and the screenshot goes to
  // a provider. A user without consent therefore uses up nothing and keeps their
  // free generation for when they accept.
  trace.stage = "consent";
  const consentFailure = await checkConsent(request, {
    consentCoveredProviders,
    consentVerifier,
    provider: providerForModel(geminiOptions.model ?? DEFAULT_MODEL),
  });
  if (consentFailure) return consentFailure;
  trace.stage = "body";

  const requestStartedAt = Date.now();

  try {
    const input = parseConversationRequest(await readJsonBody(request));
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
      const access = await checkProAccess(
        entitlementVerifier,
        authenticatedUserId,
        request.signal,
      );
      if ("response" in access) return access.response;
      entitlementWaitMs = access.waitMs;
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
        await settleGeneration({
          authorization,
          generation: input.isOnboardingGeneration
            ? "onboarding"
            : "subscription",
          leaseId: generationLease.current.leaseId,
          settlement,
          usageLimiter,
        });
      }
    }
  } catch (failure) {
    return generationErrorResponse(failure, (safeError) =>
      safeError instanceof UnusableScreenshotError
        ? safeError.reason
        : undefined,
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
