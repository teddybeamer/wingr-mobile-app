import assert from "node:assert/strict";
import test from "node:test";
import { ConsentVerificationError } from "./ai-consent.ts";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { input } from "./test-fixtures.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";

// The original /ai-conversation endpoint is still deployed, so it must enforce
// consent as well: no AI endpoint may be reachable without it.
function spies() {
  const calls = { entitlement: 0, provider: 0, claim: 0 };
  return {
    calls,
    options: {
      entitlementVerifier: {
        verifyAccess: async () => {
          calls.entitlement++;
          return { hasActivePro: true, plan: "monthly" as const };
        },
      },
      fetchImpl: (async () => {
        calls.provider++;
        return Response.json({});
      }) as typeof fetch,
      getVerifiedUserId: async () => USER_ID,
      usageLimiter: {
        claim: async () => {
          calls.claim++;
          return { expiresAt: new Date().toISOString(), leaseId: "x" };
        },
        claimOnboarding: async () => {
          calls.claim++;
          return { expiresAt: new Date().toISOString(), leaseId: "x" };
        },
        release: async () => true,
      },
    },
  };
}

const request = () =>
  new Request("http://localhost/ai-conversation", {
    body: JSON.stringify(input),
    headers: { authorization: "Bearer signed-user" },
    method: "POST",
  });

test("the original endpoint refuses a request without consent before any lookup, claim or provider call", async () => {
  const { calls, options } = spies();
  const response = await handleConversationRequest(request(), "key", {
    ...options,
    consentVerifier: { hasConsent: async () => false },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ai_consent_required");
  assert.deepEqual(calls, { claim: 0, entitlement: 0, provider: 0 });
});

test("the original endpoint treats an uncheckable consent as unavailable and fails closed without a verifier", async () => {
  for (const consentVerifier of [
    undefined,
    {
      hasConsent: async () => {
        throw new ConsentVerificationError();
      },
    },
  ]) {
    const { calls, options } = spies();
    const response = await handleConversationRequest(request(), "key", {
      ...options,
      consentVerifier,
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).code,
      "consent_verification_unavailable",
    );
    assert.deepEqual(calls, { claim: 0, entitlement: 0, provider: 0 });
  }
});
