import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createSupabaseConsentStore,
  createSupabaseConsentVerifier,
} from "../_shared/ai-consent.ts";
import { handleAiConsentRequest } from "../_shared/ai-consent-handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// This client has no administrative credentials. getClaims verifies the caller's
// JWT before its subject is used as the user id.
const callerClient = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve((request) =>
  handleAiConsentRequest(request, {
    async getVerifiedUserId(accessToken) {
      const { data, error } = await callerClient.auth.getClaims(accessToken);
      if (error || typeof data?.claims?.sub !== "string") return null;
      return data.claims.sub;
    },
    store: createSupabaseConsentStore({ serviceRoleKey, supabaseUrl }),
    verifier: createSupabaseConsentVerifier({ publishableKey, supabaseUrl }),
  }),
);
