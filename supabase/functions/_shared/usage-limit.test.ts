import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "./conversation.ts";
import { createSupabaseUsageLimiter } from "./usage-limit.ts";

const LEASE_ID = "00000000-0000-4000-8000-000000000101";
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();

test("usage limiter begins and releases a lease with the caller JWT", async () => {
  let calls = 0;
  const expiration = expiresAt();
  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(
        url,
        calls === 1
          ? "https://wingr.supabase.co/rest/v1/rpc/begin_ai_generation"
          : "https://wingr.supabase.co/rest/v1/rpc/release_ai_generation_lease",
      );
      assert.deepEqual(
        new Headers(init?.headers),
        new Headers({
          apikey: "publishable-key",
          authorization: "Bearer user-token",
          "content-type": "application/json",
        }),
      );
      if (calls === 1) {
        assert.equal(init?.body, '{"is_onboarding":false}');
        return Response.json({
          status: "allowed",
          retryAt: null,
          leaseId: LEASE_ID,
          expiresAt: expiration,
        });
      }
      assert.equal(init?.body, `{"requested_lease_id":"${LEASE_ID}"}`);
      return Response.json(true);
    },
  });
  const lease = await limiter.claim("Bearer user-token");
  assert.deepEqual(lease, { expiresAt: expiration, leaseId: LEASE_ID });
  assert.equal(await limiter.release("Bearer user-token", lease.leaseId), true);
  assert.equal(calls, 2);
});

test("usage limiter exposes a typed limit error without calling Gemini", async () => {
  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () =>
      Response.json({
        status: "usage_limit",
        retryAt: "2026-10-09T14:34:00+00:00",
      }),
  });
  await assert.rejects(
    limiter.claim("Bearer user-token"),
    (error: unknown) =>
      error instanceof ConversationError &&
      error.kind === "usage_limit" &&
      error.retryAt === "2026-10-09T14:34:00.000Z",
  );
});

test("usage limiter exposes an active lease as a typed retryable error", async () => {
  const expiration = expiresAt();
  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () =>
      Response.json({
        status: "generation_in_progress",
        retryAt: expiration,
      }),
  });
  await assert.rejects(
    limiter.claim("Bearer user-token"),
    (error: unknown) =>
      error instanceof ConversationError &&
      error.kind === "generation_in_progress" &&
      error.retryAt === expiration,
  );
});

test("malformed acquisition and release responses fail closed", async () => {
  for (const response of [
    Response.json({ status: "allowed" }),
    new Response("unavailable", { status: 503 }),
  ]) {
    const limiter = createSupabaseUsageLimiter({
      supabaseUrl: "https://wingr.supabase.co",
      publishableKey: "publishable-key",
      fetchImpl: async () => response,
    });
    await assert.rejects(
      limiter.claim("Bearer user-token"),
      (error: unknown) =>
        error instanceof ConversationError &&
        error.kind === "generation_protection_unavailable",
    );
  }

  const limiter = createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl: async () => Response.json({ released: true }),
  });
  await assert.rejects(
    limiter.release("Bearer user-token", LEASE_ID),
    (error: unknown) =>
      error instanceof ConversationError &&
      error.kind === "generation_protection_unavailable",
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
      fetchImpl: async (url, init) => {
        assert.equal(
          url,
          "https://wingr.supabase.co/rest/v1/rpc/begin_ai_generation",
        );
        assert.equal(init?.body, '{"is_onboarding":true}');
        return Response.json(
          response === "allowed"
            ? {
                status: response,
                retryAt: null,
                leaseId: LEASE_ID,
                expiresAt: expiresAt(),
              }
            : { status: response, retryAt: null },
        );
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
