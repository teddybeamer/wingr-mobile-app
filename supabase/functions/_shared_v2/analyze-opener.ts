// Start Conversation (ai-opener endpoint): one dating-profile screenshot in, a
// read of the profile and openers out. Same order and the same safeguards as
// Get Replies (ai-request.ts): authentication, consent before anything else,
// a bounded body, the Pro entitlement, the shared quota lease and its
// settlement. There is no free onboarding path.
import {
  CONSENT_COVERED_PROVIDERS,
  type ConsentVerifier,
} from "../_shared/ai-consent.ts";
import { handleCors } from "../_shared/cors.ts";
import { error, json } from "../_shared/http.ts";
import type { RevenueCatEntitlementVerifier } from "../_shared/revenuecat-entitlement.ts";
import {
  authenticate,
  checkConsent,
  checkProAccess,
  generationErrorResponse,
  readJsonBody,
  recordProviderLatency,
  settleGeneration,
} from "./ai-request.ts";
import { ConversationError } from "./conversation.ts";
import {
  isUnusableProfileReason,
  OPENER_OUTPUT_CONTRACT,
  openerSchema,
  parseOpenerRequest,
  parseProviderOpenerResult,
  toPublicOpenerResult,
  UnusableProfileError,
  type OpenerRequest,
  type ProviderOpenerResult,
  type UnusableProfileReason,
} from "./opener.ts";
import { buildOpenerPrompt, OPENER_SYSTEM_PROMPT } from "./opener-prompting.ts";
import {
  DEFAULT_MODEL,
  providerForModel,
  requestStructuredResult,
  type StructuredCall,
  type StructuredCallOptions,
} from "./openrouter.ts";
import type {
  GenerationLease,
  SettlementOutcome,
  UsageLimiter,
} from "./usage-limit.ts";

export type OpenerHandlerOptions = Omit<
  StructuredCallOptions,
  "onProviderDispatch" | "onProviderLatency" | "signal"
> & {
  consentVerifier?: ConsentVerifier;
  // Providers the consent text names. Only tests set this.
  consentCoveredProviders?: readonly string[];
  entitlementVerifier?: RevenueCatEntitlementVerifier;
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  usageLimiter?: UsageLimiter;
};

export function openerCall(
  request: OpenerRequest,
): StructuredCall<ProviderOpenerResult> {
  return {
    contract: OPENER_OUTPUT_CONTRACT,
    image: request.screenshot,
    parse: (value) => parseProviderOpenerResult(value, request),
    schema: openerSchema,
    schemaName: "wingr_profile_openers",
    systemPrompt: OPENER_SYSTEM_PROMPT,
    userText: buildOpenerPrompt(request),
  };
}

// User-facing messages that differ from Get Replies' wording.
const OPENER_MESSAGES: Partial<Record<ConversationError["kind"], string>> = {
  invalid_output: "WiNGR could not write reliable openers. Please try again.",
  invalid_request:
    "Choose a PNG, JPEG, or WebP screenshot of their profile under 10 MB.",
  provider: "WiNGR could not read that profile right now. Please try again.",
  timeout: "WiNGR took too long to read that profile. Please try again.",
  unusable_screenshot:
    "WiNGR couldn’t find a dating profile in that screenshot. Try a screenshot of their profile.",
};

// One outcome line per POST, like Get Replies, with `feature` to tell the two
// apart. Closed labels, a status and a duration only.
type OutcomeStage =
  | "auth"
  | "consent"
  | "body"
  | "entitlement"
  | "quota"
  | "provider"
  | "done";
type RequestTrace = { stage: OutcomeStage };

const OUTCOME_CATEGORIES = {
  ai_consent_required: "consent",
  ai_provider_not_disclosed: "technical",
  authentication_verification_unavailable: "technical",
  consent_verification_unavailable: "technical",
  generation_in_progress: "quota",
  generation_protection_unavailable: "technical",
  invalid_output: "provider",
  invalid_request: "client_input",
  payload_too_large: "client_input",
  provider: "provider",
  subscription_required: "entitlement",
  subscription_verification_unavailable: "technical",
  timeout: "provider",
  unauthorized: "authentication",
  unusable_screenshot: "invalid_screenshot",
  usage_limit: "quota",
} as const;

async function recordRequestOutcome({
  durationMs,
  response,
  stage,
}: {
  durationMs: number;
  response: Response | null;
  stage: OutcomeStage;
}) {
  try {
    let category: string = "technical";
    let code: string = "unknown";
    let reason: UnusableProfileReason | null = null;
    if (response?.ok) {
      category = "ok";
      code = "ok";
    } else if (response) {
      let body: { code?: unknown; reason?: unknown } | null = null;
      try {
        body = await response.clone().json();
      } catch {
        // Not one of our JSON errors: reported as unknown.
      }
      if (
        typeof body?.code === "string" &&
        Object.hasOwn(OUTCOME_CATEGORIES, body.code)
      ) {
        code = body.code;
        category =
          OUTCOME_CATEGORIES[body.code as keyof typeof OUTCOME_CATEGORIES];
        if (
          code === "unusable_screenshot" &&
          isUnusableProfileReason(body.reason)
        )
          reason = body.reason;
      }
    }
    const log = response ? console.info : console.error;
    log("[Wingr AI] request outcome", {
      category,
      code,
      durationMs,
      event: "ai_request_outcome",
      feature: "start_conversation",
      generation: "subscription",
      reason,
      stage,
      status: response?.status ?? 500,
    });
  } catch {
    // Logging must never change the response.
  }
}

async function handleRequest(
  request: Request,
  apiKey: string,
  options: OpenerHandlerOptions,
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
    usageLimiter,
    ...providerOptions
  } = options;

  const authentication = await authenticate(request, getVerifiedUserId);
  if ("response" in authentication) return authentication.response;

  // Consent before the body is read, the entitlement is looked up, a lease is
  // taken, or the screenshot goes to a provider.
  trace.stage = "consent";
  const consentFailure = await checkConsent(request, {
    consentCoveredProviders,
    consentVerifier,
    provider: providerForModel(providerOptions.model ?? DEFAULT_MODEL),
  });
  if (consentFailure) return consentFailure;

  try {
    trace.stage = "body";
    const input = parseOpenerRequest(await readJsonBody(request));

    trace.stage = "entitlement";
    const access = await checkProAccess(
      entitlementVerifier,
      authentication.userId,
      request.signal,
    );
    if ("response" in access) return access.response;

    const authorization = request.headers.get("authorization");
    const lease: { current: GenerationLease | null } = { current: null };
    // Anything not decided below (timeouts, provider errors, invalid output,
    // aborts) stays "failure" and costs nothing.
    let settlement: SettlementOutcome = "failure";
    trace.stage = "provider";
    try {
      const result = await requestStructuredResult(openerCall(input), apiKey, {
        ...providerOptions,
        signal: request.signal,
        onProviderLatency: (measurement) =>
          recordProviderLatency("subscription", measurement),
        onProviderDispatch: async () => {
          trace.stage = "quota";
          if (!usageLimiter)
            throw new ConversationError("generation_protection_unavailable");
          lease.current = await usageLimiter.reserve(
            authorization,
            access.plan,
          );
          trace.stage = "provider";
        },
      });
      if (!result.usable) {
        const reason = result.failureReason ?? "unknown";
        // An unreadable image or a non-profile counts toward the same
        // one-in-five rule as invalid chat screenshots; anything else is free.
        settlement = reason === "unknown" ? "failure" : "invalid_screenshot";
        throw new UnusableProfileError(reason);
      }
      settlement = "success";
      trace.stage = "done";
      return json(toPublicOpenerResult(result));
    } finally {
      if (lease.current && usageLimiter)
        await settleGeneration({
          authorization,
          generation: "subscription",
          leaseId: lease.current.leaseId,
          settlement,
          usageLimiter,
        });
    }
  } catch (failure) {
    return generationErrorResponse(
      failure,
      (safeError) =>
        safeError instanceof UnusableProfileError
          ? safeError.reason
          : undefined,
      (kind) => OPENER_MESSAGES[kind],
    );
  }
}

export async function handleOpenerRequest(
  request: Request,
  apiKey: string,
  options: OpenerHandlerOptions = {},
) {
  const trace: RequestTrace = { stage: "auth" };
  // Only a POST is a generation request.
  if (request.method !== "POST")
    return handleRequest(request, apiKey, options, trace);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await handleRequest(request, apiKey, options, trace);
  } catch (failure) {
    await recordRequestOutcome({
      durationMs: Date.now() - startedAt,
      response: null,
      stage: trace.stage,
    });
    throw failure;
  }
  await recordRequestOutcome({
    durationMs: Date.now() - startedAt,
    response,
    stage: trace.stage,
  });
  return response;
}
