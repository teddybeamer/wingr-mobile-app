import { ConversationError, parseRetryAt } from "./conversation.ts";
import type { RevenueCatSubscriptionPlan } from "../_shared/revenuecat-entitlement.ts";

// v2 charges a generation when it is settled, not when it is claimed (see
// migration 20261020140000_ai_generation_settlement.sql):
//   reserve  checks the plan limit and takes the per-user lease; it charges nothing.
//   settle   ends the lease and applies the charge rule for the outcome.
// The older limiter in ../_shared/usage-limit.ts is unchanged and still charges at
// claim time for the original endpoint.

export type GenerationLease = {
  expiresAt: string;
  leaseId: string;
};

// success            -> 1 attempt
// invalid_screenshot -> every 5th (within 30 days) costs 1 attempt
// failure            -> 0 attempts (technical failures and other rejections)
export type SettlementOutcome = "success" | "invalid_screenshot" | "failure";

export type Settlement = {
  // False when the lease was already settled or replaced: nothing was charged.
  applied: boolean;
  charged: boolean;
};

export type UsageLimiter = {
  reserve(
    authorization: string | null,
    subscriptionPlan: RevenueCatSubscriptionPlan,
  ): Promise<GenerationLease>;
  settle(
    authorization: string | null,
    leaseId: string,
    outcome: SettlementOutcome,
  ): Promise<Settlement>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES: readonly SettlementOutcome[] = [
  "success",
  "invalid_screenshot",
  "failure",
];
// Settlement runs on the response path, so it is bounded. It is never retried:
// a retry could only help by risking a second charge for the same generation.
export const SETTLEMENT_TIMEOUT_MS = 3_000;

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
  const rpc = (name: string) =>
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`;

  return {
    async reserve(authorization, subscriptionPlan) {
      if (!validAuthorization(authorization)) throw protectionFailure();
      if (subscriptionPlan !== "weekly" && subscriptionPlan !== "monthly")
        throw protectionFailure();
      let response: Response;
      try {
        response = await fetchImpl(rpc("reserve_ai_generation"), {
          method: "POST",
          headers: headers(authorization!),
          body: JSON.stringify({ subscription_plan: subscriptionPlan }),
        });
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
      const expiresAt = parseRetryAt(result?.expiresAt);
      if (
        result?.status !== "allowed" ||
        typeof result?.leaseId !== "string" ||
        !UUID_PATTERN.test(result.leaseId) ||
        !expiresAt
      )
        throw protectionFailure();
      return { expiresAt, leaseId: result.leaseId };
    },
    async settle(authorization, leaseId, outcome) {
      if (
        !validAuthorization(authorization) ||
        !UUID_PATTERN.test(leaseId) ||
        !OUTCOMES.includes(outcome)
      )
        throw protectionFailure();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SETTLEMENT_TIMEOUT_MS);
      let result;
      try {
        const response = await fetchImpl(rpc("settle_ai_generation"), {
          method: "POST",
          headers: headers(authorization!),
          body: JSON.stringify({ requested_lease_id: leaseId, outcome }),
          signal: controller.signal,
        });
        if (!response.ok) throw protectionFailure();
        result = await response.json();
      } catch {
        throw protectionFailure();
      } finally {
        clearTimeout(timer);
      }
      if (
        (result?.status !== "settled" && result?.status !== "not_found") ||
        typeof result?.charged !== "boolean"
      )
        throw protectionFailure();
      return { applied: result.status === "settled", charged: result.charged };
    },
  };
}
