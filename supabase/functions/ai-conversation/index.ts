import { handleConversationRequest } from "../_shared/analyze-conversation.ts";
import { createSupabaseUsageLimiter } from "../_shared/usage-limit.ts";

const usageLimiter = createSupabaseUsageLimiter({
  publishableKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
});

Deno.serve((request) =>
  handleConversationRequest(request, Deno.env.get("OPENROUTER_API_KEY") ?? "", {
    usageLimiter,
  }),
);
