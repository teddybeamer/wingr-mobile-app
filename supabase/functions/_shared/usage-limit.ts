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
    rpc: string,
  ): Promise<unknown> => {
    if (!authorization?.startsWith("Bearer ") || !publishableKey || !supabaseUrl)
      throw new ConversationError("provider");
    let response: Response;
    try {
      response = await fetchImpl(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`,
        {
          method: "POST",
          headers: {
            apikey: publishableKey,
            authorization,
            "content-type": "application/json",
          },
          body: "{}",
        },
      );
    } catch {
      throw new ConversationError("provider");
    }
    if (!response.ok) throw new ConversationError("provider");
    try {
      return await response.json();
    } catch {
      throw new ConversationError("provider");
    }
  };
  return {
    async claim(authorization) {
      const allowed = await claim(authorization, "claim_ai_generation_attempt");
      if (allowed === false) throw new ConversationError("usage_limit");
      if (allowed !== true) throw new ConversationError("provider");
    },
    async claimOnboarding(authorization) {
      const result = await claim(
        authorization,
        "claim_onboarding_ai_generation_attempt",
      );
      if (result === "onboarding_reply_used")
        throw new ConversationError("onboarding_reply_used");
      if (result === "usage_limit") throw new ConversationError("usage_limit");
      if (result !== "allowed") throw new ConversationError("provider");
    },
  };
}
