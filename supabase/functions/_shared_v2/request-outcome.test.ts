import assert from "node:assert/strict";
import test from "node:test";
import {
  handleConversationRequest,
  type ConversationHandlerOptions,
} from "./analyze-conversation.ts";
import { ConversationError } from "./conversation.ts";
import { asProviderResult, input, result } from "./test-fixtures.ts";
import type { GenerationLease } from "./usage-limit.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const LEASE_ID = "00000000-0000-4000-8000-000000000101";
const API_KEY = "PRIVATE_API_KEY";
const TOKEN = "signed-user-token";
const DEVICE_TOKEN = "dGVzdC1kZXZpY2UtdG9rZW4=";
const TRIAL_ID = "00000000-0000-4000-8000-0000000000a1";
const lease = (): GenerationLease => ({
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  leaseId: LEASE_ID,
});

const post = (body: unknown = input, headers: Record<string, string> = {}) =>
  new Request("http://localhost/ai-conversation-v2", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const provider =
  (value: unknown): typeof fetch =>
  async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(asProviderResult(value)) },
        },
      ],
    });
const unusable = (failureReason: string) => ({
  replyable: false,
  failureReason,
  vibeCheck: null,
  replies: [],
});
const run = (
  request: Request,
  options: ConversationHandlerOptions = {},
  apiKey = API_KEY,
) =>
  handleConversationRequest(request, apiKey, {
    entitlementVerifier: {
      verifyAccess: async () => ({ hasActivePro: true, plan: "monthly" }),
    },
    getVerifiedUserId: async () => USER_ID,
    usageLimiter: {
      reserve: async () => lease(),
      settle: async () => ({ applied: true, charged: true }),
    },
    fetchImpl: provider(result),
    ...options,
  });

// Captures every console call, whatever its level, and returns the outcome lines.
function captureLogs(t: test.TestContext) {
  const calls: { args: unknown[]; level: string }[] = [];
  for (const level of ["info", "warn", "error", "log"] as const)
    t.mock.method(console, level, (...args: unknown[]) => {
      calls.push({ args, level });
    });
  return {
    all: () => calls,
    outcomes: () =>
      calls.filter(({ args }) => args[0] === "[Wingr AI] request outcome"),
  };
}

type Expected = {
  category: string;
  code: string;
  generation: string;
  reason?: string | null;
  stage: string;
  status: number;
};
async function expectOutcome(
  t: test.TestContext,
  name: string,
  request: Request,
  options: ConversationHandlerOptions,
  expected: Expected,
  apiKey?: string,
) {
  const logs = captureLogs(t);
  const response = await run(request, options, apiKey);
  assert.equal(response.status, expected.status, `${name}: status`);
  const outcomes = logs.outcomes();
  assert.equal(outcomes.length, 1, `${name}: exactly one outcome line`);
  const fields = outcomes[0].args[1] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(fields).sort(),
    [
      "category",
      "code",
      "durationMs",
      "event",
      "generation",
      "reason",
      "stage",
      "status",
    ],
    `${name}: fixed field set`,
  );
  assert.equal(fields.event, "ai_request_outcome", name);
  assert.equal(typeof fields.durationMs, "number", name);
  assert.ok((fields.durationMs as number) >= 0, name);
  for (const key of [
    "category",
    "code",
    "generation",
    "stage",
    "status",
  ] as const)
    assert.equal(fields[key], expected[key], `${name}: ${key}`);
  assert.equal(fields.reason, expected.reason ?? null, `${name}: reason`);
  assert.equal(outcomes[0].level, "info", `${name}: level`);
  return { logs, response };
}

const paid = (
  category: string,
  code: string,
  status: number,
  stage: string,
  reason: string | null = null,
): Expected => ({
  category,
  code,
  generation: "subscription",
  reason,
  stage,
  status,
});

test("a successful paid generation logs one ok outcome", async (t) => {
  await expectOutcome(t, "success", post(), {}, paid("ok", "ok", 200, "done"));
});

test("every invalid screenshot reason is logged as invalid_screenshot with its reason", async (t) => {
  for (const reason of [
    "unreadable_image",
    "no_conversation",
    "ownership_unclear",
    "no_replyable_message",
    "unknown",
  ])
    await expectOutcome(
      t,
      reason,
      post(),
      { fetchImpl: provider(unusable(reason)) },
      paid(
        "invalid_screenshot",
        "unusable_screenshot",
        422,
        "provider",
        reason,
      ),
    );
  // A model that returns nothing usable and no reason is the "unknown" reason.
  await expectOutcome(
    t,
    "no reason",
    post(),
    {
      fetchImpl: provider({ replyable: false, vibeCheck: null, replies: [] }),
    },
    paid(
      "invalid_screenshot",
      "unusable_screenshot",
      422,
      "provider",
      "unknown",
    ),
  );
});

test("provider failures are logged as provider outcomes, apart from invalid screenshots", async (t) => {
  await expectOutcome(
    t,
    "provider error",
    post(),
    { fetchImpl: async () => new Response(null, { status: 503 }) },
    paid("provider", "provider", 502, "provider"),
  );
  await expectOutcome(
    t,
    "invalid output",
    post(),
    { fetchImpl: provider({ ...result, replies: [] }) },
    paid("provider", "invalid_output", 502, "provider"),
  );
  await expectOutcome(
    t,
    "timeout",
    post(),
    {
      timeoutMs: 5,
      fetchImpl: async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    },
    paid("provider", "timeout", 504, "provider"),
  );
  // No API key configured: a provider-stage failure, before dispatch.
  await expectOutcome(
    t,
    "missing key",
    post(),
    {},
    paid("provider", "provider", 502, "provider"),
    "",
  );
});

test("quota outcomes are logged at the quota stage", async (t) => {
  for (const [code, status] of [
    ["usage_limit", 429],
    ["generation_in_progress", 429],
  ] as const)
    await expectOutcome(
      t,
      code,
      post(),
      {
        usageLimiter: {
          reserve: async () => {
            throw new ConversationError(
              code,
              undefined,
              undefined,
              new Date(Date.now() + 5_000).toISOString(),
            );
          },
          settle: async () => ({ applied: true, charged: false }),
        },
      },
      paid("quota", code, status, "quota"),
    );
});

test("entitlement, authentication and infrastructure failures are told apart", async (t) => {
  await expectOutcome(
    t,
    "no pro",
    post(),
    {
      entitlementVerifier: {
        verifyAccess: async () => ({ hasActivePro: false }),
      },
    },
    paid("entitlement", "subscription_required", 403, "entitlement"),
  );
  await expectOutcome(
    t,
    "verifier throws",
    post(),
    {
      entitlementVerifier: {
        verifyAccess: async () => {
          throw new Error("RevenueCat down");
        },
      },
    },
    paid(
      "technical",
      "subscription_verification_unavailable",
      503,
      "entitlement",
    ),
  );
  await expectOutcome(
    t,
    "no verifier",
    post(),
    { entitlementVerifier: undefined },
    paid(
      "technical",
      "subscription_verification_unavailable",
      503,
      "entitlement",
    ),
  );
  const unknownGeneration = (
    category: string,
    code: string,
    status: number,
    stage: string,
  ): Expected => ({
    category,
    code,
    generation: "unknown",
    reason: null,
    stage,
    status,
  });
  await expectOutcome(
    t,
    "no authorization header",
    new Request("http://localhost/ai-conversation-v2", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    {},
    unknownGeneration("authentication", "unauthorized", 401, "auth"),
  );
  await expectOutcome(
    t,
    "unverifiable token",
    post(),
    { getVerifiedUserId: async () => null },
    unknownGeneration("authentication", "unauthorized", 401, "auth"),
  );
  await expectOutcome(
    t,
    "verification throws",
    post(),
    {
      getVerifiedUserId: async () => {
        throw new Error("auth down");
      },
    },
    unknownGeneration(
      "technical",
      "authentication_verification_unavailable",
      503,
      "auth",
    ),
  );
  await expectOutcome(
    t,
    "no verification configured",
    post(),
    { getVerifiedUserId: undefined },
    unknownGeneration(
      "technical",
      "authentication_verification_unavailable",
      503,
      "auth",
    ),
  );
});

test("protection failures are technical and reported at the stage they happened", async (t) => {
  await expectOutcome(
    t,
    "reserve unavailable",
    post(),
    {
      usageLimiter: {
        reserve: async () => {
          throw new ConversationError("generation_protection_unavailable");
        },
        settle: async () => ({ applied: true, charged: false }),
      },
    },
    paid("technical", "generation_protection_unavailable", 503, "quota"),
  );
  await expectOutcome(
    t,
    "no limiter",
    post(),
    { usageLimiter: undefined },
    paid("technical", "generation_protection_unavailable", 503, "quota"),
  );
});

test("malformed and oversized requests are client input, before the generation is known", async (t) => {
  const body = (generation: string): Expected => ({
    category: "client_input",
    code: "invalid_request",
    generation,
    reason: null,
    stage: "body",
    status: 400,
  });
  await expectOutcome(t, "not JSON", post("{"), {}, body("unknown"));
  await expectOutcome(
    t,
    "bad image",
    post({ ...input, screenshot: "not an image" }),
    {},
    body("unknown"),
  );
  await expectOutcome(
    t,
    "onboarding without DeviceCheck token",
    post({ ...input, isOnboardingGeneration: true }),
    {},
    body("onboarding"),
  );
  await expectOutcome(
    t,
    "too large",
    post(input, { "content-length": String(15 * 1024 * 1024) }),
    {},
    {
      category: "client_input",
      code: "payload_too_large",
      generation: "unknown",
      reason: null,
      stage: "body",
      status: 413,
    },
  );
});

test("onboarding outcomes are logged with the onboarding stages", async (t) => {
  const onboarding = post({
    ...input,
    deviceCheckToken: DEVICE_TOKEN,
    isOnboardingGeneration: true,
    onboardingTrialId: TRIAL_ID,
  });
  const onboard = (
    category: string,
    code: string,
    status: number,
    stage: string,
    reason: string | null = null,
  ): Expected => ({
    category,
    code,
    generation: "onboarding",
    reason,
    stage,
    status,
  });
  const generating = (
    complete: (value: typeof result) => Promise<typeof result> = async (
      value,
    ) => value,
  ) => ({
    prepare: async () => ({
      kind: "generate" as const,
      abandon: async () => {},
      complete,
    }),
  });
  const request = () => onboarding.clone();

  await expectOutcome(
    t,
    "onboarding success",
    request(),
    { onboardingTrialManager: generating() },
    onboard("ok", "ok", 200, "done"),
  );
  await expectOutcome(
    t,
    "onboarding replay",
    request(),
    {
      onboardingTrialManager: {
        prepare: async () => ({
          kind: "replay" as const,
          replay: result,
          abandon: async () => {},
          complete: async () => result,
        }),
      },
    },
    onboard("ok", "ok", 200, "onboarding_replay"),
  );
  await expectOutcome(
    t,
    "device already used",
    request(),
    {
      onboardingTrialManager: {
        prepare: async () => {
          throw new ConversationError("onboarding_device_reply_used");
        },
      },
    },
    onboard("quota", "onboarding_device_reply_used", 409, "onboarding_trial"),
  );
  await expectOutcome(
    t,
    "onboarding in progress",
    request(),
    {
      onboardingTrialManager: {
        prepare: async () => {
          throw new ConversationError("generation_in_progress");
        },
      },
    },
    onboard("quota", "generation_in_progress", 429, "onboarding_trial"),
  );
  await expectOutcome(
    t,
    "onboarding invalid screenshot",
    request(),
    {
      onboardingTrialManager: generating(),
      fetchImpl: provider(unusable("no_conversation")),
    },
    onboard(
      "invalid_screenshot",
      "unusable_screenshot",
      422,
      "provider",
      "no_conversation",
    ),
  );
  await expectOutcome(
    t,
    "onboarding provider failure",
    request(),
    {
      onboardingTrialManager: generating(),
      fetchImpl: async () => new Response(null, { status: 503 }),
    },
    onboard("provider", "provider", 502, "provider"),
  );
  await expectOutcome(
    t,
    "onboarding finalization failure",
    request(),
    {
      onboardingTrialManager: generating(async () => {
        throw new ConversationError("generation_protection_unavailable");
      }),
    },
    onboard(
      "technical",
      "generation_protection_unavailable",
      503,
      "onboarding_finalize",
    ),
  );
  await expectOutcome(
    t,
    "no trial manager",
    request(),
    { onboardingTrialManager: undefined },
    onboard("technical", "generation_protection_unavailable", 503, "body"),
  );
});

test("preflight and wrong-method requests are not outcomes", async (t) => {
  const logs = captureLogs(t);
  for (const method of ["OPTIONS", "GET"])
    await run(new Request("http://localhost/ai-conversation-v2", { method }));
  assert.equal(logs.outcomes().length, 0);
});

test("an unhandled exception is logged once as an error and still rethrown", async (t) => {
  const logs = captureLogs(t);
  const request = post();
  Object.defineProperty(request, "headers", {
    get() {
      throw new Error("unexpected");
    },
  });
  await assert.rejects(run(request), /unexpected/);
  const outcomes = logs.outcomes();
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].level, "error");
  assert.deepEqual(outcomes[0].args[1], {
    category: "technical",
    code: "unknown",
    durationMs: (outcomes[0].args[1] as { durationMs: number }).durationMs,
    event: "ai_request_outcome",
    generation: "unknown",
    reason: null,
    stage: "auth",
    status: 500,
  });
});

test("the response body is untouched by outcome logging", async (t) => {
  captureLogs(t);
  const response = await run(post(), {
    fetchImpl: provider(unusable("unreadable_image")),
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    code: "unusable_screenshot",
    error:
      "WiNGR could not find a readable conversation to reply to. Try another screenshot.",
    reason: "unreadable_image",
  });
  const success = await run(post());
  assert.deepEqual(await success.json(), result);
});

test("a failing logger never changes the response", async (t) => {
  t.mock.method(console, "info", () => {
    throw new Error("log sink unavailable");
  });
  const response = await run(post(), { getVerifiedUserId: async () => null });
  assert.equal(response.status, 401);
});

test("outcome lines contain no screenshot, text, identifier, token or key", async (t) => {
  const logs = captureLogs(t);
  const marker = "PRIVATE-CONTEXT-MARKER";
  const requests: [Request, ConversationHandlerOptions][] = [
    [post({ ...input, extraContext: marker }), {}],
    [
      post({ ...input, extraContext: marker }),
      { fetchImpl: provider(unusable("unreadable_image")) },
    ],
    [
      post({ ...input, extraContext: marker }),
      { fetchImpl: async () => new Response(marker, { status: 500 }) },
    ],
    [
      post({ ...input, extraContext: marker }),
      {
        usageLimiter: {
          reserve: async () => {
            throw new ConversationError("usage_limit");
          },
          settle: async () => ({ applied: true, charged: false }),
        },
      },
    ],
  ];
  for (const [request, options] of requests) await run(request, options);
  const serialized = JSON.stringify(logs.outcomes().map(({ args }) => args));
  assert.equal(logs.outcomes().length, requests.length);
  for (const secret of [
    input.screenshot,
    marker,
    result.replies[0],
    result.vibeCheck.summary,
    USER_ID,
    TOKEN,
    API_KEY,
    LEASE_ID,
    "Bearer",
  ])
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
});
