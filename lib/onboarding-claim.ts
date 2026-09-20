import {
  getSupabaseConfiguration,
  getSupabaseRequestAuthentication,
  type SupabaseRequestAuthentication,
} from "./supabase-auth";

const ONBOARDING_CLAIM_STATUS_TIMEOUT_MS = 5_000;

export async function hasClaimedOnboardingReply({
  fetchImpl = fetch,
  getAuthentication = getSupabaseRequestAuthentication,
  supabaseUrl = getSupabaseConfiguration().url,
  timeoutMs = ONBOARDING_CLAIM_STATUS_TIMEOUT_MS,
}: {
  fetchImpl?: typeof fetch;
  getAuthentication?: () => Promise<SupabaseRequestAuthentication>;
  supabaseUrl?: string;
  timeoutMs?: number;
} = {}) {
  const authentication = await getAuthentication();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/has_claimed_onboarding_ai_reply`,
      {
        method: "POST",
        headers: {
          apikey: authentication.publishableKey,
          authorization: `Bearer ${authentication.accessToken}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error("Wingr could not restore onboarding progress.");
    }
    const claimed = await response.json();
    if (typeof claimed !== "boolean") {
      throw new Error("Wingr received invalid onboarding progress.");
    }
    return claimed;
  } finally {
    clearTimeout(timer);
  }
}
