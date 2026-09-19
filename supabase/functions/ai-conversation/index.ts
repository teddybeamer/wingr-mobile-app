import { createClient } from "npm:@supabase/supabase-js@2";
import { handleConversationRequest } from "../_shared/analyze-conversation.ts";
import { createRevenueCatEntitlementVerifier } from "../_shared/revenuecat-entitlement.ts";
import { createSupabaseUsageLimiter } from "../_shared/usage-limit.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const usageLimiter = createSupabaseUsageLimiter({
  publishableKey,
  supabaseUrl,
});
const entitlementVerifier = createRevenueCatEntitlementVerifier({
  apiKey: Deno.env.get("REVENUECAT_V2_SECRET_API_KEY") ?? "",
  monthlyProductResourceId:
    Deno.env.get("REVENUECAT_MONTHLY_PRODUCT_RESOURCE_ID") ?? "",
  proEntitlementResourceId:
    Deno.env.get("REVENUECAT_PRO_ENTITLEMENT_RESOURCE_ID") ?? "",
  projectId: Deno.env.get("REVENUECAT_PROJECT_ID") ?? "",
  weeklyProductResourceId:
    Deno.env.get("REVENUECAT_WEEKLY_PRODUCT_RESOURCE_ID") ?? "",
});
// This client has no administrative credentials. getClaims verifies the caller's
// JWT before its subject is used as the RevenueCat App User ID.
const callerClient = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve((request) =>
  handleConversationRequest(request, Deno.env.get("OPENROUTER_API_KEY") ?? "", {
    entitlementVerifier,
    async getVerifiedUserId(accessToken) {
      const { data, error } = await callerClient.auth.getClaims(accessToken);
      if (error || typeof data?.claims?.sub !== "string") return null;
      return data.claims.sub;
    },
    usageLimiter,
  }),
);
