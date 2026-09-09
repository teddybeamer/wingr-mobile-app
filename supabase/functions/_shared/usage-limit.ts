import { ConversationError } from "./conversation.ts";

export type UsageLimiter = {
  claim(authorization: string | null): Promise<void>;
  claimOnboarding(authorization: string | null): Promise<void>;
};

export function createSupabaseUsageLimiter({
  fetchImpl = fetch,
  publishableKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  publishableKey: string;
  supabaseUrl: string;
}): UsageLimiter {
  const claim = async (
    authorization: string | null,
    isOnboarding: boolean,
  ): Promise<void> => {
    if (!authorization?.startsWith("Bearer ") || !publishableKey || !supabaseUrl)
      throw new ConversationError("provider");
    let response: Response;
    try {
      response = await fetchImpl(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/claim_ai_generation_attempt_with_availability`,
        {
          method: "POST",
          headers: {
            apikey: publishableKey,
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({ is_onboarding: isOnboarding }),
        },
      );
    } catch {
      throw new ConversationError("provider");
    }
    if (!response.ok) throw new ConversationError("provider");
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ConversationError("provider");
    }
    if (result?.status === "usage_limit")
      throw new ConversationError("usage_limit", undefined, undefined, result.retryAt);
    if (isOnboarding && result?.status === "onboarding_reply_used")
      throw new ConversationError("onboarding_reply_used");
    if (result?.status !== "allowed") throw new ConversationError("provider");
  };
  return {
    async claim(authorization) {
      await claim(authorization, false);
    },
    async claimOnboarding(authorization) {
      await claim(authorization, true);
    },
  };
}
