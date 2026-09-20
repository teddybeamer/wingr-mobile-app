import assert from "node:assert/strict";
import test from "node:test";
import { hasClaimedOnboardingReply } from "./onboarding-claim";

const authentication = {
  accessToken: "test-access-token",
  publishableKey: "test-publishable-key",
  userId: "00000000-0000-4000-8000-000000000701",
};

test("onboarding claim status calls the authenticated read-only RPC", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const claimed = await hasClaimedOnboardingReply({
    fetchImpl: async (url, init) => {
      requestedUrl = String(url);
      requestedInit = init;
      return Response.json(true);
    },
    getAuthentication: async () => authentication,
    supabaseUrl: "https://wingr.supabase.co/",
  });

  assert.equal(claimed, true);
  assert.equal(
    requestedUrl,
    "https://wingr.supabase.co/rest/v1/rpc/has_claimed_onboarding_ai_reply",
  );
  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.body, "{}");
  assert.deepEqual(requestedInit?.headers, {
    apikey: authentication.publishableKey,
    authorization: `Bearer ${authentication.accessToken}`,
    "content-type": "application/json",
  });
});

test("onboarding claim status rejects unavailable or malformed responses", async () => {
  const options = {
    getAuthentication: async () => authentication,
    supabaseUrl: "https://wingr.supabase.co",
  };
  await assert.rejects(
    hasClaimedOnboardingReply({
      ...options,
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    /restore onboarding progress/,
  );
  await assert.rejects(
    hasClaimedOnboardingReply({
      ...options,
      fetchImpl: async () => Response.json({ claimed: true }),
    }),
    /invalid onboarding progress/,
  );
});
