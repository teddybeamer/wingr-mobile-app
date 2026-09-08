import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "./conversation.ts";
import { createSupabaseUsageLimiter } from "./usage-limit.ts";

test("usage limiter calls the atomic RPC with the caller JWT", async () => {
  let calls = 0;
  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, "https://wingr.supabase.co/rest/v1/rpc/claim_ai_generation_attempt");
      assert.deepEqual(new Headers(init?.headers), new Headers({
        apikey: "publishable-key",
        authorization: "Bearer user-token",
        "content-type": "application/json",
      }));
      assert.equal(init?.body, "{}");
      return Response.json(true);
    },
  });
  await limiter.claim("Bearer user-token");
  assert.equal(calls, 1);
});

test("usage limiter exposes a typed limit error without calling Gemini", async () => {
  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () => Response.json(false),
  });
  await assert.rejects(
    limiter.claim("Bearer user-token"),
    (error: unknown) =>
      error instanceof ConversationError && error.kind === "usage_limit",
  );
});

test("onboarding claims use their own atomic RPC and preserve typed rejections", async () => {
  for (const [response, kind] of [
    ["allowed", undefined],
    ["onboarding_reply_used", "onboarding_reply_used"],
    ["usage_limit", "usage_limit"],
  ] as const) {
    const limiter = createSupabaseUsageLimiter({
      supabaseUrl: "https://wingr.supabase.co",
      publishableKey: "publishable-key",
      fetchImpl: async (url) => {
        assert.equal(
          url,
          "https://wingr.supabase.co/rest/v1/rpc/claim_onboarding_ai_generation_attempt",
        );
        return Response.json(response);
      },
    });
    if (!kind) await limiter.claimOnboarding("Bearer user-token");
    else
      await assert.rejects(
        limiter.claimOnboarding("Bearer user-token"),
        (error: unknown) =>
          error instanceof ConversationError && error.kind === kind,
      );
  }
});
