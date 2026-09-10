import { clearOnboardingReplyProgress } from "./onboarding-progress";
import { posthog } from "./posthog";
import { clearSupabaseAuthSession } from "./supabase-auth";

/** Clears every local value currently tied to a Supabase Wingr account. */
export async function clearAccountLocalState() {
  await clearSupabaseAuthSession();
  await clearOnboardingReplyProgress();
  // This intentionally runs after server-side account deletion has succeeded.
  posthog.reset();
}
