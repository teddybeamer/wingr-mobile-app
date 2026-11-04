import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONSENT_RECIPIENTS,
  AI_CONSENT_RECIPIENTS_KEY,
  AI_CONSENT_RECIPIENTS_TEXT,
  AI_CONSENT_VERSION,
  ConsentVerificationError,
  createSupabaseConsentStore,
  createSupabaseConsentVerifier,
  isCurrentConsent,
  isProviderCoveredByConsent,
  type ConsentStore,
  type ConsentVerifier,
} from "./ai-consent.ts";
import { handleAiConsentRequest } from "./ai-consent-handler.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN = "caller-token";

const current = {
  recipients: AI_CONSENT_RECIPIENTS_KEY,
  version: AI_CONSENT_VERSION,
};

test("the consent text names OpenRouter and Google Vertex AI and only those are covered", () => {
  assert.deepEqual(
    [...AI_CONSENT_RECIPIENTS],
    ["OpenRouter", "Google Vertex AI"],
  );
  assert.equal(AI_CONSENT_RECIPIENTS_TEXT, "OpenRouter and Google Vertex AI");
  assert.equal(isProviderCoveredByConsent("google-vertex/global"), true);
  assert.equal(isProviderCoveredByConsent("inference-net/fp8"), false);
  assert.equal(isProviderCoveredByConsent("anything-else"), false);
});

test("a consent only counts for the current version and recipients", () => {
  assert.equal(isCurrentConsent(current), true);
  assert.equal(isCurrentConsent({ ...current, version: "older" }), false);
  assert.equal(
    isCurrentConsent({ ...current, recipients: "OpenRouter" }),
    false,
  );
  assert.equal(
    isCurrentConsent({ recipients: undefined, version: undefined }),
    false,
  );
});

function verifierWith(response: () => Promise<Response> | Response) {
  const calls: { headers: Headers; url: string }[] = [];
  const verifier = createSupabaseConsentVerifier({
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ headers: new Headers(init?.headers), url });
      return response();
    }) as typeof fetch,
    publishableKey: "publishable",
    supabaseUrl: "https://project.supabase.co",
  });
  return { calls, verifier };
}

test("the verifier reads the caller's own consent with the caller's token", async () => {
  const { calls, verifier } = verifierWith(() =>
    Response.json({ granted: true, ...current }),
  );
  assert.equal(await verifier.hasConsent(`Bearer ${TOKEN}`), true);
  assert.equal(
    calls[0].url,
    "https://project.supabase.co/rest/v1/rpc/get_ai_consent",
  );
  assert.equal(calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(calls[0].headers.get("apikey"), "publishable");
});

test("a missing, withdrawn, older or differently addressed consent is not a consent", async () => {
  for (const body of [
    { granted: false },
    { granted: false, ...current },
    { granted: true, recipients: current.recipients, version: "older" },
    { granted: true, recipients: "Somebody Else", version: current.version },
  ]) {
    const { verifier } = verifierWith(() => Response.json(body));
    assert.equal(await verifier.hasConsent(`Bearer ${TOKEN}`), false);
  }
});

test("a database or network failure is an unavailable check, never a missing consent", async () => {
  for (const response of [
    () => new Response("nope", { status: 500 }),
    () => new Response("not json", { status: 200 }),
    () => Response.json({ unexpected: true }),
    () => {
      throw new Error("offline");
    },
  ]) {
    const { verifier } = verifierWith(response);
    await assert.rejects(
      verifier.hasConsent(`Bearer ${TOKEN}`),
      ConsentVerificationError,
    );
  }
  const { verifier } = verifierWith(() => Response.json({ granted: true }));
  await assert.rejects(verifier.hasConsent(null), ConsentVerificationError);
});

test("the store records the server's own version and recipients for the verified user", async () => {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const store = createSupabaseConsentStore({
    fetchImpl: (async (url: string, init?: RequestInit) => {
      urls.push(url);
      bodies.push(JSON.parse(String(init?.body)));
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer service-role",
      );
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    serviceRoleKey: "service-role",
    supabaseUrl: "https://project.supabase.co",
  });
  await store.grant(USER_ID);
  await store.withdraw(USER_ID);
  assert.deepEqual(bodies, [
    {
      requested_recipients: AI_CONSENT_RECIPIENTS_KEY,
      requested_version: AI_CONSENT_VERSION,
      target_user_id: USER_ID,
    },
    { target_user_id: USER_ID },
  ]);
  assert.deepEqual(
    urls.map((url) => url.split("/rpc/")[1]),
    ["record_ai_consent", "withdraw_ai_consent"],
  );
});

function consentRequest(body: unknown, token: string | null = TOKEN) {
  return new Request("https://example.test/ai-consent", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
}

function handlerHarness() {
  const granted: string[] = [];
  const withdrawn: string[] = [];
  const store: ConsentStore = {
    grant: async (userId) => {
      granted.push(userId);
    },
    withdraw: async (userId) => {
      withdrawn.push(userId);
    },
  };
  const verifier: ConsentVerifier = { hasConsent: async () => true };
  return {
    granted,
    options: {
      getVerifiedUserId: async () => USER_ID,
      store,
      verifier,
    },
    withdrawn,
  };
}

test("accepting stores consent for the verified user and ignores any user id in the body", async () => {
  const { granted, options } = handlerHarness();
  const response = await handleAiConsentRequest(
    consentRequest({
      action: "accept",
      recipients: [...AI_CONSENT_RECIPIENTS],
      userId: "11111111-1111-4111-8111-111111111111",
      version: AI_CONSENT_VERSION,
    }),
    options,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { granted: true });
  assert.deepEqual(granted, [USER_ID]);
});

test("accepting an outdated or altered consent text is refused and stores nothing", async () => {
  for (const body of [
    {
      action: "accept",
      recipients: [...AI_CONSENT_RECIPIENTS],
      version: "older",
    },
    {
      action: "accept",
      recipients: ["OpenRouter"],
      version: AI_CONSENT_VERSION,
    },
    { action: "accept", version: AI_CONSENT_VERSION },
    { action: "accept" },
  ]) {
    const { granted, options } = handlerHarness();
    const response = await handleAiConsentRequest(
      consentRequest(body),
      options,
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "consent_version_mismatch");
    assert.equal(granted.length, 0);
  }
});

test("withdrawing and reading status use the verified user", async () => {
  const { options, withdrawn } = handlerHarness();
  const withdraw = await handleAiConsentRequest(
    consentRequest({ action: "withdraw" }),
    options,
  );
  assert.deepEqual(await withdraw.json(), { granted: false });
  assert.deepEqual(withdrawn, [USER_ID]);

  const status = await handleAiConsentRequest(
    consentRequest({ action: "status" }),
    options,
  );
  assert.deepEqual(await status.json(), { granted: true });
});

test("requests without a valid identity, a known action or a working database are refused", async () => {
  const { options } = handlerHarness();
  assert.equal(
    (
      await handleAiConsentRequest(
        consentRequest({ action: "status" }, null),
        options,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await handleAiConsentRequest(consentRequest({ action: "status" }), {
        ...options,
        getVerifiedUserId: async () => null,
      })
    ).status,
    401,
  );
  assert.equal(
    (await handleAiConsentRequest(consentRequest({ action: "dance" }), options))
      .status,
    400,
  );
  assert.equal(
    (await handleAiConsentRequest(consentRequest({ action: "status" }), {}))
      .status,
    503,
  );
  const unavailable = await handleAiConsentRequest(
    consentRequest({ action: "status" }),
    {
      ...options,
      verifier: {
        hasConsent: async () => {
          throw new ConsentVerificationError();
        },
      },
    },
  );
  assert.equal(unavailable.status, 503);
  assert.equal(
    (await unavailable.json()).code,
    "consent_verification_unavailable",
  );
});
