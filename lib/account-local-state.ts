import {
  clearOnboardingCompletion,
  clearOnboardingReplyProgress,
} from "./onboarding-progress";
import { posthog } from "./posthog";
import { clearRevenueCatIdentity } from "./revenuecat";
import { clearSupabaseAuthSession } from "./supabase-auth";

/** Clears every local value currently tied to a Supabase Wingr account. */
export async function clearAccountLocalState() {
  await clearRevenueCatIdentity().catch(() => {
    // The next initialization still logs in with the replacement Supabase ID.
  });
  await clearSupabaseAuthSession();
  await clearOnboardingReplyProgress();
  await clearOnboardingCompletion();
  // This intentionally runs after server-side account deletion has succeeded.
  posthog.reset();
}
