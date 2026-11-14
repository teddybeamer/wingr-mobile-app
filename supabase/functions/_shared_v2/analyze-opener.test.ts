import assert from "node:assert/strict";
import test from "node:test";
import { consentGranted } from "../_shared/test-fixtures.ts";
import {
  handleOpenerRequest,
  type OpenerHandlerOptions,
} from "./analyze-opener.ts";
import { ConversationError } from "./conversation.ts";
import {
  anotherOpener,
  profileScreenshot,
  starterOpeners,
} from "./opener-fixtures.ts";
import type { GenerationLease, SettlementOutcome } from "./usage-limit.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const LEASE_ID = "00000000-0000-4000-8000-000000000101";
const lease = (): GenerationLease => ({
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  leaseId: LEASE_ID,
});

const startersBody = { kind: "starters", screenshot: profileScreenshot };
const anotherBody = {
  kind: "another",
  previousOpeners: ["Earlier opener"],
  screenshot: profileScreenshot,
  selectedTone: "direct",
};

const post = (body: unknown = startersBody, token = "signed-user-token") =>
  new Request("http://localhost/ai-opener", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const providerAnswer = (value: unknown) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
  });
const usable = (value: { angle: unknown; openers: unknown }) => ({
  usable: true,
  failureReason: null,
  ...value,
});
const declined = (failureReason: string) => ({
  usable: false,
  failureReason,
  angle: null,
  openers: [],
});

// Counts every step that could spend or send something, and records what the
// provider was sent and how the lease was settled.
function setup(answer: unknown = usable(starterOpeners)) {
  const calls = { entitlement: 0, provider: 0, reserve: 0, settle: 0 };
  const settlements: SettlementOutcome[] = [];
  const sent: unknown[] = [];
  const options: OpenerHandlerOptions = {
    consentVerifier: consentGranted,
    entitlementVerifier: {
      verifyAccess: async () => {
        calls.entitlement += 1;
        return { hasActivePro: true, plan: "monthly" };
      },
    },
    fetchImpl: async (_url, init) => {
      calls.provider += 1;
      sent.push(JSON.parse(String(init?.body)));
      return providerAnswer(answer);
    },
    getVerifiedUserId: async () => USER_ID,
    usageLimiter: {
      reserve: async () => {
        calls.reserve += 1;
        return lease();
      },
      settle: async (_authorization, _leaseId, outcome) => {
        calls.settle += 1;
        settlements.push(outcome);
        return { applied: true, charged: outcome === "success" };
      },
    },
  };
  return { calls, options, sent, settlements };
}

const untouched = { entitlement: 0, provider: 0, reserve: 0, settle: 0 };

test("starters return the read and one opener per tone, and the lease settles as a success", async () => {
  const { calls, options, sent, settlements } = setup();
  const response = await handleOpenerRequest(post(), "key", options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), starterOpeners);
  assert.deepEqual(calls, {
    entitlement: 1,
    provider: 1,
    reserve: 1,
    settle: 1,
  });
  assert.deepEqual(settlements, ["success"]);
  const body = sent[0] as {
    response_format: { json_schema: { name: string } };
  };
  assert.equal(body.response_format.json_schema.name, "wingr_profile_openers");
});

test("another opener returns one opener in the chosen tone and no read", async () => {
  const { options } = setup(usable(anotherOpener));
  const response = await handleOpenerRequest(post(anotherBody), "key", options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), anotherOpener);
});

test("without consent nothing is looked up, reserved or sent", async () => {
  const { calls, options } = setup();
  const response = await handleOpenerRequest(post(), "key", {
    ...options,
    consentVerifier: { hasConsent: async () => false },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ai_consent_required");
  assert.deepEqual(calls, untouched);
});

test("an undisclosed provider stops the request before consent or anything else", async () => {
  const { calls, options } = setup();
  const response = await handleOpenerRequest(post(), "key", {
    ...options,
    consentCoveredProviders: [],
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ai_provider_not_disclosed");
  assert.deepEqual(calls, untouched);
});

test("a request without a verified user is refused", async () => {
  const { calls, options } = setup();
  assert.equal(
    (await handleOpenerRequest(post(startersBody, ""), "key", options)).status,
    401,
  );
  assert.equal(
    (
      await handleOpenerRequest(post(), "key", {
        ...options,
        getVerifiedUserId: async () => "not-a-uuid",
      })
    ).status,
    401,
  );
  assert.deepEqual(calls, untouched);
});

test("an invalid body is rejected before the entitlement or provider", async () => {
  for (const body of [
    "not json",
    { kind: "starters" },
    { kind: "another", screenshot: profileScreenshot },
  ]) {
    const { calls, options } = setup();
    const response = await handleOpenerRequest(post(body), "key", options);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
    assert.deepEqual(calls, untouched);
  }
});

test("without Pro the request stops before the quota and provider", async () => {
  const { calls, options } = setup();
  const response = await handleOpenerRequest(post(), "key", {
    ...options,
    entitlementVerifier: {
      verifyAccess: async () => ({ hasActivePro: false }),
    },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "subscription_required");
  assert.equal(calls.reserve, 0);
  assert.equal(calls.provider, 0);
});

test("a screenshot that is not a profile is a 422 with its reason and counts like an invalid chat screenshot", async () => {
  for (const reason of ["not_a_profile", "unreadable_image"]) {
    const { options, settlements } = setup(declined(reason));
    const response = await handleOpenerRequest(post(), "key", options);
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, "unusable_screenshot");
    assert.equal(body.reason, reason);
    assert.match(body.error, /dating profile/);
    assert.deepEqual(settlements, ["invalid_screenshot"]);
  }
  const { options, settlements } = setup(declined("something_else"));
  const response = await handleOpenerRequest(post(), "key", options);
  assert.equal((await response.json()).reason, "unknown");
  assert.deepEqual(settlements, ["failure"]);
});

test("an answer that breaks the contract is free and reported as invalid output", async () => {
  const { options, settlements } = setup(
    usable({ ...starterOpeners, openers: starterOpeners.openers.slice(1) }),
  );
  const response = await handleOpenerRequest(post(), "key", options);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "invalid_output");
  assert.match(body.error, /openers/);
  assert.deepEqual(settlements, ["failure"]);
});

test("a reached limit stops the request before the provider", async () => {
  const { calls, options } = setup();
  const retryAt = new Date(Date.now() + 3_600_000).toISOString();
  const response = await handleOpenerRequest(post(), "key", {
    ...options,
    usageLimiter: {
      reserve: async () => {
        throw new ConversationError(
          "usage_limit",
          undefined,
          undefined,
          retryAt,
        );
      },
      settle: async () => ({ applied: true, charged: false }),
    },
  });
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.code, "usage_limit");
  assert.equal(body.retryAt, retryAt);
  assert.equal(calls.provider, 0);
});

test("every request writes one outcome line tagged as Start Conversation, with no private data", async (t) => {
  const lines: unknown[] = [];
  for (const level of ["info", "warn", "error"] as const)
    t.mock.method(console, level, (message: unknown, fields: unknown) => {
      if (message === "[Wingr AI] request outcome") lines.push(fields);
    });
  const { options } = setup(declined("not_a_profile"));
  await handleOpenerRequest(post(), "key", options);
  assert.equal(lines.length, 1);
  const line = lines[0] as Record<string, unknown>;
  assert.equal(line.feature, "start_conversation");
  assert.equal(line.code, "unusable_screenshot");
  assert.equal(line.reason, "not_a_profile");
  assert.equal(line.stage, "provider");
  assert.equal(line.status, 422);
  const serialized = JSON.stringify(line);
  for (const secret of [USER_ID, "signed-user-token", "iVBORw0KGgo"])
    assert.ok(!serialized.includes(secret));
});
