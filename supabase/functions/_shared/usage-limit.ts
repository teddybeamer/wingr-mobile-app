import { ConversationError, parseRetryAt } from "./conversation.ts";
import type { RevenueCatSubscriptionPlan } from "./revenuecat-entitlement.ts";

export type GenerationLease = {
  expiresAt: string;
  leaseId: string;
};

export type UsageLimiter = {
  claim(
    authorization: string | null,
    subscriptionPlan: RevenueCatSubscriptionPlan,
  ): Promise<GenerationLease>;
  claimOnboarding(authorization: string | null): Promise<GenerationLease>;
  release(authorization: string | null, leaseId: string): Promise<boolean>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_RELEASE_TIMEOUT_MS = 2_000;

export function createSupabaseUsageLimiter({
  fetchImpl = fetch,
  publishableKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  publishableKey: string;
  supabaseUrl: string;
}): UsageLimiter {
  const headers = (authorization: string) => ({
    apikey: publishableKey,
    authorization,
    "content-type": "application/json",
  });
  const protectionFailure = () =>
    new ConversationError("generation_protection_unavailable");
  const validAuthorization = (authorization: string | null) =>
    authorization?.startsWith("Bearer ") && publishableKey && supabaseUrl;
  const claim = async (
    authorization: string | null,
    isOnboarding: boolean,
    subscriptionPlan?: RevenueCatSubscriptionPlan,
  ): Promise<GenerationLease> => {
    if (!validAuthorization(authorization)) throw protectionFailure();
    if (
      !isOnboarding &&
      subscriptionPlan !== "weekly" &&
      subscriptionPlan !== "monthly"
    )
      throw protectionFailure();
    let response: Response;
    try {
      response = await fetchImpl(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/begin_ai_generation`,
        {
          method: "POST",
          headers: headers(authorization!),
          body: JSON.stringify(
            isOnboarding
              ? { is_onboarding: true }
              : {
                  is_onboarding: false,
                  subscription_plan: subscriptionPlan,
                },
          ),
        },
      );
    } catch {
      throw protectionFailure();
    }
    if (!response.ok) throw protectionFailure();
    let result;
    try {
      result = await response.json();
    } catch {
      throw protectionFailure();
    }
    if (result?.status === "usage_limit")
      throw new ConversationError(
        "usage_limit",
        undefined,
        undefined,
        result.retryAt,
      );
    if (result?.status === "generation_in_progress")
      throw new ConversationError(
        "generation_in_progress",
        undefined,
        undefined,
        result.retryAt,
      );
    if (isOnboarding && result?.status === "onboarding_reply_used")
      throw new ConversationError("onboarding_reply_used");
    const expiresAt = parseRetryAt(result?.expiresAt);
    if (
      result?.status !== "allowed" ||
      typeof result?.leaseId !== "string" ||
      !UUID_PATTERN.test(result.leaseId) ||
      !expiresAt
    )
      throw protectionFailure();
    return { expiresAt, leaseId: result.leaseId };
  };
  return {
    claim(authorization, subscriptionPlan) {
      return claim(authorization, false, subscriptionPlan);
    },
    claimOnboarding(authorization) {
      return claim(authorization, true);
    },
    async release(authorization, leaseId) {
      if (!validAuthorization(authorization) || !UUID_PATTERN.test(leaseId))
        throw protectionFailure();
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        LEASE_RELEASE_TIMEOUT_MS,
      );
      let released;
      try {
        const response = await fetchImpl(
          `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/release_ai_generation_lease`,
          {
            method: "POST",
            headers: headers(authorization!),
            body: JSON.stringify({ requested_lease_id: leaseId }),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw protectionFailure();
        released = await response.json();
      } catch {
        throw protectionFailure();
      } finally {
        clearTimeout(timer);
      }
      if (typeof released !== "boolean") throw protectionFailure();
      return released;
    },
  };
}
