import { createClient } from "npm:@supabase/supabase-js@2";
import {
  handleDeleteAccountRequest,
  type AccountDeletionDependencies,
} from "../_shared/delete-account.ts";

type SupabaseError = { code?: string; status?: number };

function isMissingUser(error: SupabaseError | null | undefined) {
  return error?.status === 404 || error?.code === "user_not_found";
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// This client is only used to verify the caller's bearer token. It has no
// administrative capability.
const callerClient = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// SUPABASE_SERVICE_ROLE_KEY exists only in Edge Function secrets, never in app code.
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function accountIsAbsent(userId: string) {
  const { error } = await adminClient.auth.admin.getUserById(userId);
  if (!error) return false;
  if (isMissingUser(error)) return true;
  throw new Error("auth_lookup_failed");
}

const dependencies: AccountDeletionDependencies = {
  async getVerifiedSubject(accessToken) {
    const { data, error } = await callerClient.auth.getClaims(accessToken);
    if (error || typeof data?.claims?.sub !== "string") return null;
    return data.claims.sub;
  },
  async getAuthenticatedUser(accessToken, subject) {
    const { data, error } = await callerClient.auth.getUser(accessToken);
    if (error || !data.user) {
      if (await accountIsAbsent(subject)) return null;
      throw new Error("auth_user_lookup_failed");
    }
    return {
      id: data.user.id,
      isAnonymous: data.user.is_anonymous === true,
    };
  },
  async deleteVerifiedUser(subject) {
    const { error } = await adminClient.auth.admin.deleteUser(subject);
    if (!error) return;
    // A concurrent request may have deleted the same verified subject first.
    if (isMissingUser(error) && (await accountIsAbsent(subject))) return;
    throw new Error("auth_delete_failed");
  },
  logFailure(code) {
    console.warn("[Wingr account deletion] failed", { code });
  },
};

Deno.serve((request) => handleDeleteAccountRequest(request, dependencies));
