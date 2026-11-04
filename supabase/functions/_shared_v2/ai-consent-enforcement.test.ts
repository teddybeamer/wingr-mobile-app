import assert from "node:assert/strict";
import test from "node:test";
import { ConsentVerificationError } from "../_shared/ai-consent.ts";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { DEEPSEEK_MODEL } from "./openrouter.ts";
import { asProviderResult, input, result } from "./test-fixtures.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TRIAL_ID = "00000000-0000-4000-8000-000000000002";

// Every place a request could spend something or send data. Consent must be
// checked before ANY of them, so a refused request leaves all of these at zero.
function createSpies() {
  const calls = {
    bodyRead: 0,
    entitlement: 0,
    prepare: 0,
    provider: 0,
    reserve: 0,
    settle: 0,
  };
  const options = {
    entitlementVerifier: {
      verifyAccess: async () => {
        calls.entitlement++;
        return { hasActivePro: true, plan: "monthly" as const };
      },
    },
    fetchImpl: (async () => {
      calls.provider++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(asProviderResult(result)) },
          },
        ],
      });
    }) as typeof fetch,
    getVerifiedUserId: async () => USER_ID,
    onboardingTrialManager: {
      async prepare() {
        calls.prepare++;
        return {
          abandon: async () => {},
          complete: async (value: typeof result) => value,
          kind: "generate" as const,
        };
      },
    },
    usageLimiter: {
      reserve: async () => {
        calls.reserve++;
        return {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          leaseId: "00000000-0000-4000-8000-000000000101",
        };
      },
      settle: async () => {
        calls.settle++;
        return { applied: true, charged: true };
      },
    },
  };
  return { calls, options };
}

const untouched = {
  bodyRead: 0,
  entitlement: 0,
  prepare: 0,
  provider: 0,
  reserve: 0,
  settle: 0,
};

function subscriptionRequest() {
  return new Request("http://localhost/ai-conversation-v2", {
    body: JSON.stringify(input),
    headers: { authorization: "Bearer signed-user" },
    method: "POST",
  });
}

function onboardingRequest() {
  return new Request("http://localhost/ai-conversation-v2", {
    body: JSON.stringify({
      ...input,
      deviceCheckToken: "dGVzdC1kZXZpY2UtdG9rZW4=",
      isOnboardingGeneration: true,
      onboardingTrialId: TRIAL_ID,
    }),
    headers: { authorization: "Bearer signed-user" },
    method: "POST",
  });
}

const noConsent = { hasConsent: async () => false };
const hasConsent = { hasConsent: async () => true };

test("without consent both generation paths are refused before the body, DeviceCheck trial, entitlement, quota lease or provider", async () => {
  for (const build of [subscriptionRequest, onboardingRequest]) {
    const { calls, options } = createSpies();
    const response = await handleConversationRequest(build(), "key", {
      ...options,
      consentVerifier: noConsent,
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "ai_consent_required");
    assert.deepEqual(calls, untouched);
  }
});

test("declining first keeps the free DeviceCheck generation: it is only spent once consent is given", async () => {
  const { calls, options } = createSpies();
  const declined = await handleConversationRequest(onboardingRequest(), "key", {
    ...options,
    consentVerifier: noConsent,
  });
  assert.equal(declined.status, 403);
  assert.equal(calls.prepare, 0);
  assert.equal(calls.provider, 0);

  // The same user accepts later and the very same request now generates.
  const accepted = await handleConversationRequest(onboardingRequest(), "key", {
    ...options,
    consentVerifier: hasConsent,
  });
  assert.equal(accepted.status, 200);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.provider, 1);
});

test("a refused subscription request takes no quota lease, so nothing is charged or left locked", async () => {
  const { calls, options } = createSpies();
  await handleConversationRequest(subscriptionRequest(), "key", {
    ...options,
    consentVerifier: noConsent,
  });
  assert.equal(calls.reserve, 0);
  assert.equal(calls.settle, 0);

  const accepted = await handleConversationRequest(
    subscriptionRequest(),
    "key",
    { ...options, consentVerifier: hasConsent },
  );
  assert.equal(accepted.status, 200);
  assert.equal(calls.reserve, 1);
  assert.equal(calls.settle, 1);
});

test("a consent check that cannot be completed is an unavailable service, not a missing consent, and sends nothing", async () => {
  for (const consentVerifier of [
    undefined,
    {
      hasConsent: async () => {
        throw new ConsentVerificationError();
      },
    },
  ]) {
    const { calls, options } = createSpies();
    const response = await handleConversationRequest(
      subscriptionRequest(),
      "key",
      { ...options, consentVerifier },
    );
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).code,
      "consent_verification_unavailable",
    );
    assert.deepEqual(calls, untouched);
  }
});

test("a consent decision of another user cannot be used: the caller's own token is what is checked", async () => {
  const { options } = createSpies();
  const seen: (string | null)[] = [];
  await handleConversationRequest(subscriptionRequest(), "key", {
    ...options,
    consentVerifier: {
      hasConsent: async (authorization) => {
        seen.push(authorization);
        return true;
      },
    },
  });
  assert.deepEqual(seen, ["Bearer signed-user"]);
});

test("a model whose provider the consent text does not name is refused before anything is sent", async () => {
  const { calls, options } = createSpies();
  const response = await handleConversationRequest(
    subscriptionRequest(),
    "key",
    {
      ...options,
      consentVerifier: hasConsent,
      model: DEEPSEEK_MODEL,
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ai_provider_not_disclosed");
  assert.equal(calls.provider, 0);
  assert.equal(calls.reserve, 0);
});

test("the default model goes to the disclosed provider only", async () => {
  const sent: { provider?: { allow_fallbacks?: boolean; only?: string[] } }[] =
    [];
  const { options } = createSpies();
  const response = await handleConversationRequest(
    subscriptionRequest(),
    "key",
    {
      ...options,
      consentVerifier: hasConsent,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return options.fetchImpl(_url as never, init);
      }) as typeof fetch,
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(sent[0].provider?.only, ["google-vertex/global"]);
  assert.equal(sent[0].provider?.allow_fallbacks, false);
});
