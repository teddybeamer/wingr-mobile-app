// The parts every AI endpoint shares, in the order a request meets them:
// authentication, consent, a bounded body, the Pro entitlement, the quota
// settlement and the error response. Get Replies (analyze-conversation.ts) and
// Start Conversation (analyze-opener.ts) differ only in their request, prompt
// and result; they must not differ in who may send what to a provider.
import {
  ConsentVerificationError,
  type ConsentVerifier,
} from "../_shared/ai-consent.ts";
import { json } from "../_shared/http.ts";
import { RevenueCatVerificationError } from "../_shared/revenuecat-entitlement.ts";
import type {
  RevenueCatAccess,
  RevenueCatEntitlementVerifier,
  RevenueCatSubscriptionPlan,
} from "../_shared/revenuecat-entitlement.ts";
import { ConversationError } from "./conversation.ts";
import type { ProviderLatencyMeasurement } from "./openrouter.ts";
import type { SettlementOutcome, UsageLimiter } from "./usage-limit.ts";

export type GenerationLabel = "onboarding" | "subscription";

export function recordProviderLatency(
  generation: GenerationLabel,
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
  generation: GenerationLabel;
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

// Settled synchronously, exactly once, and never retried: the database makes
// settlement idempotent per lease, but a retry here could only matter by risking
// a second charge. If settlement fails after a valid result, the result is still
// returned and the user is not charged; the failure is logged for investigation.
// A failed settlement of a free outcome costs nothing, and the 60-second lease
// TTL frees the user.
export async function settleGeneration({
  authorization,
  generation,
  leaseId,
  settlement,
  usageLimiter,
}: {
  authorization: string | null;
  generation: GenerationLabel;
  leaseId: string;
  settlement: SettlementOutcome;
  usageLimiter: UsageLimiter;
}) {
  const settleStartedAt = Date.now();
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

export async function readRequestBodyWithinLimit(
  request: Request,
): Promise<string> {
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

// Reads and parses a JSON body within the size limit. Anything that is not
// JSON is an invalid request; an oversized body is payload_too_large.
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await readRequestBodyWithinLimit(request));
  } catch (failure) {
    if (failure instanceof ConversationError) throw failure;
    throw new ConversationError("invalid_request");
  }
}

export const ACCESS_ERRORS = {
  ai_consent_required: {
    message:
      "Please allow WiNGR to share your screenshot with its AI providers to use this feature.",
    status: 403,
  },
  ai_provider_not_disclosed: {
    message:
      "WiNGR could not start the AI service right now. Please try again.",
    status: 503,
  },
  authentication_verification_unavailable: {
    message: "Wingr could not verify your account right now. Please try again.",
    status: 503,
  },
  consent_verification_unavailable: {
    message:
      "Wingr could not check your AI sharing choice right now. Please try again.",
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
export type AccessErrorCode = keyof typeof ACCESS_ERRORS;

export function accessError(code: AccessErrorCode) {
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

export function retryAfterHeader(retryAt: string | undefined) {
  if (!retryAt) return undefined;
  const milliseconds = Date.parse(retryAt) - Date.now();
  if (!Number.isFinite(milliseconds)) return undefined;
  return { "retry-after": String(Math.max(1, Math.ceil(milliseconds / 1000))) };
}

// The caller's verified user ID, or the response that ends the request.
export async function authenticate(
  request: Request,
  getVerifiedUserId:
    | ((accessToken: string) => Promise<string | null>)
    | undefined,
): Promise<{ userId: string } | { response: Response }> {
  const accessToken = bearerToken(request);
  if (!accessToken) return { response: accessError("unauthorized") };
  if (!getVerifiedUserId)
    return { response: accessError("authentication_verification_unavailable") };
  let userId: string | null;
  try {
    userId = await getVerifiedUserId(accessToken);
  } catch {
    return { response: accessError("authentication_verification_unavailable") };
  }
  const authenticatedUserId = userId?.trim() ?? "";
  if (!isUuid(authenticatedUserId))
    return { response: accessError("unauthorized") };
  return { userId: authenticatedUserId };
}

// Consent comes before anything that could spend or send something: callers run
// this before the body is read, an entitlement is looked up, a quota lease is
// taken, or an image goes to a provider. The provider this deployment would use
// must also be one the consent names, so a change of model or routing to an
// undisclosed provider stops here instead of silently sending data there.
// Returns the response that ends the request, or null to continue.
export async function checkConsent(
  request: Request,
  {
    consentCoveredProviders,
    consentVerifier,
    provider,
  }: {
    consentCoveredProviders: readonly string[];
    consentVerifier: ConsentVerifier | undefined;
    provider: string;
  },
): Promise<Response | null> {
  if (!consentCoveredProviders.includes(provider))
    return accessError("ai_provider_not_disclosed");
  if (!consentVerifier) return accessError("consent_verification_unavailable");
  try {
    if (
      !(await consentVerifier.hasConsent(request.headers.get("authorization")))
    )
      return accessError("ai_consent_required");
  } catch (failure) {
    if (failure instanceof ConsentVerificationError)
      return accessError("consent_verification_unavailable");
    throw failure;
  }
  return null;
}

// The caller's Pro plan, or the response that ends the request.
export async function checkProAccess(
  entitlementVerifier: RevenueCatEntitlementVerifier | undefined,
  userId: string,
  signal: AbortSignal,
): Promise<
  { plan: RevenueCatSubscriptionPlan; waitMs: number } | { response: Response }
> {
  if (!entitlementVerifier)
    return { response: accessError("subscription_verification_unavailable") };
  let access: RevenueCatAccess;
  const startedAt = Date.now();
  try {
    access = await entitlementVerifier.verifyAccess(userId, signal);
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
    return { response: accessError("subscription_verification_unavailable") };
  }
  if (!access.hasActivePro)
    return { response: accessError("subscription_required") };
  return { plan: access.plan, waitMs: Date.now() - startedAt };
}

// The JSON error response for a failed generation. `reasonOf` returns the
// closed-set reason of an unusable-screenshot error, if the failure has one.
// `messageOf` may replace the user-facing message for a kind (for example, an
// unusable profile screenshot is not "a readable conversation").
export function generationErrorResponse(
  failure: unknown,
  reasonOf: (failure: ConversationError) => string | undefined,
  messageOf?: (kind: ConversationError["kind"]) => string | undefined,
) {
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
  const reason = reasonOf(safeError);
  // Closed enum and numeric status only: never log a failure object or provider body.
  console.warn("[Wingr AI] request failed", {
    code: safeError.kind,
    providerStatus: safeError.providerStatus,
    providerReason: safeError.providerReason,
    reason,
  });
  const publicError = new ConversationError(
    safeError.kind,
    undefined,
    undefined,
    safeError.retryAt,
  );
  return json(
    {
      error: messageOf?.(safeError.kind) ?? publicError.message,
      code: safeError.kind,
      reason,
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
