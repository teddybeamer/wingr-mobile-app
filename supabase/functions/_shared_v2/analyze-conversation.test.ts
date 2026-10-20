import assert from "node:assert/strict";
import test from "node:test";
import {
  handleConversationRequest as handleConversationRequestCore,
  MAX_REQUEST_BODY_BYTES,
  type ConversationHandlerOptions,
} from "./analyze-conversation.ts";
import { ConversationError } from "./conversation.ts";
import { DEEPSEEK_MODEL } from "./openrouter.ts";
import {
  createRevenueCatEntitlementVerifier,
  RevenueCatVerificationError,
} from "../_shared/revenuecat-entitlement.ts";
import type { RevenueCatSubscriptionPlan } from "../_shared/revenuecat-entitlement.ts";
import {
  asProviderResult,
  input,
  providerResult,
  result,
} from "./test-fixtures.ts";
import type {
  GenerationLease,
  SettlementOutcome,
  UsageLimiter,
} from "./usage-limit.ts";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000001";
const TEST_LEASE_ID = "00000000-0000-4000-8000-000000000101";
const testLease = (leaseId = TEST_LEASE_ID): GenerationLease => ({
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  leaseId,
});
const settled = (charged = true) => ({ applied: true, charged });
const allowUsage = (): UsageLimiter => ({
  reserve: async () => testLease(),
  settle: async () => settled(),
});
// Mirrors the database rules: reserving checks the limit and takes the lease but
// charges nothing; settling ends the lease and charges 1 for a success, 1 for
// every 5th invalid screenshot, and 0 for everything else.
function createInMemoryGuard(initialAttempts: Record<string, number> = {}) {
  const active = new Map<string, GenerationLease>();
  const attempts = new Map(Object.entries(initialAttempts));
  const invalidPending = new Map<string, number>();
  const settlements: { charged: boolean; outcome: SettlementOutcome }[] = [];
  const limiter: UsageLimiter = {
    reserve: async (authorization, subscriptionPlan) => {
      await Promise.resolve();
      const user = authorization ?? "missing";
      const current = active.get(user);
      if (current)
        throw new ConversationError(
          "generation_in_progress",
          undefined,
          undefined,
          current.expiresAt,
        );
      const limit = subscriptionPlan === "weekly" ? 125 : 500;
      if ((attempts.get(user) ?? 0) >= limit)
        throw new ConversationError("usage_limit");
      const lease = testLease(crypto.randomUUID());
      active.set(user, lease);
      return lease;
    },
    settle: async (authorization, leaseId, outcome) => {
      await Promise.resolve();
      const user = authorization ?? "missing";
      if (active.get(user)?.leaseId !== leaseId)
        return { applied: false, charged: false };
      active.delete(user);
      let charged = outcome === "success";
      if (outcome === "invalid_screenshot") {
        const pending = (invalidPending.get(user) ?? 0) + 1;
        charged = pending >= 5;
        invalidPending.set(user, charged ? 0 : pending);
      }
      if (charged) attempts.set(user, (attempts.get(user) ?? 0) + 1);
      settlements.push({ charged, outcome });
      return { applied: true, charged };
    },
  };
  return {
    active,
    attemptsFor(authorization: string) {
      return attempts.get(authorization) ?? 0;
    },
    invalidPendingFor(authorization: string) {
      return invalidPending.get(authorization) ?? 0;
    },
    limiter,
    settlements,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const request = (body: unknown = input) =>
  new Request("http://localhost/ai-conversation", {
    method: "POST",
    headers: { authorization: "Bearer signed-user" },
    body: JSON.stringify(body),
  });
const requestForUser = (user: string, body: unknown = input) =>
  new Request("http://localhost/ai-conversation", {
    method: "POST",
    headers: { authorization: `Bearer ${user}` },
    body: JSON.stringify(body),
  });
const streamedRequest = (
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) => {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) return controller.close();
      controller.enqueue(chunks[index++]);
    },
  });
  return new Request("http://localhost/ai-conversation", {
    method: "POST",
    headers: { authorization: "Bearer signed-user", ...headers },
    body,
    // Required by Node's Fetch implementation for a streamed request body.
    duplex: "half",
  } as RequestInit);
};
const handleConversationRequest = (
  request: Request,
  apiKey: string,
  options: ConversationHandlerOptions = {},
) =>
  handleConversationRequestCore(request, apiKey, {
    entitlementVerifier: {
      verifyAccess: async () => ({ hasActivePro: true, plan: "monthly" }),
    },
    getVerifiedUserId: async () => AUTHENTICATED_USER_ID,
    usageLimiter: allowUsage(),
    ...options,
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
test("endpoint returns a compact vibe and reply from one call compatible with the app", async () => {
  let calls = 0;
  const response = await handleConversationRequest(
    request({
      ...input,
      previousWingrSuggestions: ["Earlier Wingr reply"],
    }),
    "key",
    {
      fetchImpl: async (...args) => {
        calls++;
        return provider(result)(...args);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.equal(calls, 1);
});

test("normal generation verifies the authenticated user before usage and OpenRouter", async () => {
  const order: string[] = [];
  const response = await handleConversationRequest(request(), "key", {
    getVerifiedUserId: async (accessToken) => {
      assert.equal(accessToken, "signed-user");
      order.push("auth");
      return AUTHENTICATED_USER_ID;
    },
    entitlementVerifier: {
      verifyAccess: async (appUserId) => {
        assert.equal(appUserId, AUTHENTICATED_USER_ID);
        order.push("entitlement");
        return { hasActivePro: true, plan: "monthly" };
      },
    },
    usageLimiter: {
      reserve: async (_authorization, subscriptionPlan) => {
        assert.equal(subscriptionPlan, "monthly");
        order.push("usage");
        return testLease();
      },
      settle: async () => {
        order.push("settle");
        return settled();
      },
    },
    fetchImpl: async (...args) => {
      order.push("openrouter");
      return provider(result)(...args);
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(order, [
    "auth",
    "entitlement",
    "usage",
    "openrouter",
    "settle",
  ]);
});

test("missing pro returns subscription_required without usage or OpenRouter", async () => {
  let usageClaims = 0;
  let providerCalls = 0;
  const response = await handleConversationRequest(request(), "key", {
    entitlementVerifier: {
      verifyAccess: async () => ({ hasActivePro: false }),
    },
    usageLimiter: {
      reserve: async () => {
        usageClaims++;
        return testLease();
      },
      settle: async () => settled(),
    },
    fetchImpl: async (...args) => {
      providerCalls++;
      return provider(result)(...args);
    },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "subscription_required",
    error: "An active WiNGR Pro subscription is required.",
  });
  assert.equal(usageClaims, 0);
  assert.equal(providerCalls, 0);
});

test("a confirmed missing RevenueCat customer returns subscription_required", async () => {
  let revenueCatCalls = 0;
  let usageClaims = 0;
  let providerCalls = 0;
  const entitlementVerifier = createRevenueCatEntitlementVerifier({
    apiKey: "server-secret",
    monthlyProductResourceId: "prod_monthly",
    projectId: "proj_wingr",
    proEntitlementResourceId: "entl_pro",
    weeklyProductResourceId: "prod_weekly",
    fetchImpl: async () => {
      revenueCatCalls++;
      return revenueCatCalls === 1
        ? Response.json({ type: "resource_missing" }, { status: 404 })
        : Response.json({
            object: "list",
            items: [],
            next_page: null,
            url: "/v2/projects/proj_wingr/customers",
          });
    },
  });
  const response = await handleConversationRequest(request(), "key", {
    entitlementVerifier,
    usageLimiter: {
      reserve: async () => {
        usageClaims++;
        return testLease();
      },
      settle: async () => settled(),
    },
    fetchImpl: async (...args) => {
      providerCalls++;
      return provider(result)(...args);
    },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "subscription_required",
    error: "An active WiNGR Pro subscription is required.",
  });
  assert.equal(revenueCatCalls, 2);
  assert.equal(usageClaims, 0);
  assert.equal(providerCalls, 0);
});

test("request-body identity and premium fields cannot bypass the verified user entitlement", async () => {
  const checkedUsers: string[] = [];
  let usageClaims = 0;
  let providerCalls = 0;
  const response = await handleConversationRequest(
    request({
      ...input,
      appUserId: "00000000-0000-4000-8000-000000000999",
      isPro: true,
      premium: true,
      subscriptionStatus: "active",
      userId: "00000000-0000-4000-8000-000000000999",
    }),
    "key",
    {
      entitlementVerifier: {
        verifyAccess: async (appUserId) => {
          checkedUsers.push(appUserId);
          return { hasActivePro: false };
        },
      },
      usageLimiter: {
        reserve: async () => {
          usageClaims++;
          return testLease();
        },
        settle: async () => settled(),
      },
      fetchImpl: async (...args) => {
        providerCalls++;
        return provider(result)(...args);
      },
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(checkedUsers, [AUTHENTICATED_USER_ID]);
  assert.equal(usageClaims, 0);
  assert.equal(providerCalls, 0);
});

test("request-body plan and product fields cannot override the trusted RevenueCat plan", async () => {
  const claimedPlans: string[] = [];
  const response = await handleConversationRequest(
    request({
      ...input,
      plan: "monthly",
      productId: "prodeb09795a02",
      subscriptionType: "monthly",
      usageLimit: 500,
    }),
    "key",
    {
      entitlementVerifier: {
        verifyAccess: async () => ({
          hasActivePro: true,
          plan: "weekly",
        }),
      },
      usageLimiter: {
        reserve: async (_authorization, subscriptionPlan) => {
          claimedPlans.push(subscriptionPlan);
          return testLease();
        },
        settle: async () => settled(),
      },
      fetchImpl: provider(result),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(claimedPlans, ["weekly"]);
});

test("entitlement verification failures fail closed before usage and OpenRouter", async () => {
  for (const failure of [
    new Error("timeout"),
    new Error("unavailable"),
    new Error("malformed"),
  ]) {
    let usageClaims = 0;
    let providerCalls = 0;
    const response = await handleConversationRequest(request(), "key", {
      entitlementVerifier: {
        verifyAccess: async () => {
          throw failure;
        },
      },
      usageLimiter: {
        reserve: async () => {
          usageClaims++;
          return testLease();
        },
        settle: async () => settled(),
      },
      fetchImpl: async (...args) => {
        providerCalls++;
        return provider(result)(...args);
      },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      code: "subscription_verification_unavailable",
      error:
        "Wingr could not verify your subscription right now. Please try again.",
    });
    assert.equal(usageClaims, 0);
    assert.equal(providerCalls, 0);
  }
});

test("RevenueCat diagnostics contain only closed, non-identifying metadata", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => warnings.push(values);
  try {
    const response = await handleConversationRequest(request(), "PRIVATE_KEY", {
      entitlementVerifier: {
        verifyAccess: async () => {
          throw new RevenueCatVerificationError(
            "unavailable",
            403,
            "authorization_error",
            "forbidden",
            "subscriptions",
            "permissions",
          );
        },
      },
    });
    assert.equal(response.status, 503);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, [
    [
      "[Wingr AI] RevenueCat verification failed",
      {
        category: "permissions",
        code: "revenuecat_verification_failed",
        operation: "subscriptions",
        upstreamErrorCode: "forbidden",
        upstreamErrorType: "authorization_error",
        upstreamStatus: 403,
      },
    ],
  ]);
  const serialized = JSON.stringify(warnings);
  for (const privateValue of [
    "PRIVATE_KEY",
    "Bearer signed-user",
    AUTHENTICATED_USER_ID,
  ]) {
    assert.ok(!serialized.includes(privateValue));
  }
});

test("request validation rejects before RevenueCat or usage", async () => {
  let entitlementChecks = 0;
  let usageClaims = 0;
  let providerCalls = 0;
  const jpegBytesDeclaredAsPng =
    "data:image/png;base64," +
    Buffer.from([0xff, 0xd8, 0xff]).toString("base64");
  const response = await handleConversationRequest(
    request({ ...input, screenshot: jpegBytesDeclaredAsPng }),
    "key",
    {
      entitlementVerifier: {
        verifyAccess: async () => {
          entitlementChecks++;
          return { hasActivePro: true, plan: "monthly" };
        },
      },
      usageLimiter: {
        reserve: async () => {
          usageClaims++;
          return testLease();
        },
        settle: async () => settled(),
      },
      fetchImpl: async () => {
        providerCalls++;
        return provider(result)(new Request("http://localhost"));
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
  assert.equal(entitlementChecks, 0);
  assert.equal(usageClaims, 0);
  assert.equal(providerCalls, 0);
});

test("Content-Length above the request limit rejects before the body is read", async () => {
  let entitlementChecks = 0;
  let usageClaims = 0;
  let providerCalls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([123]));
    },
  });
  const req = new Request("http://localhost/ai-conversation", {
    method: "POST",
    headers: {
      authorization: "Bearer signed-user",
      "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
    },
    body,
    duplex: "half",
  } as RequestInit);
  const response = await handleConversationRequest(req, "key", {
    entitlementVerifier: {
      verifyAccess: async () => {
        entitlementChecks++;
        return { hasActivePro: true, plan: "monthly" };
      },
    },
    usageLimiter: {
      reserve: async () => {
        usageClaims++;
        return testLease();
      },
      settle: async () => settled(),
    },
    fetchImpl: async () => {
      providerCalls++;
      return provider(result)(new Request("http://localhost"));
    },
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "payload_too_large");
  assert.equal(req.bodyUsed, false);
  assert.equal(entitlementChecks, 0);
  assert.equal(usageClaims, 0);
  assert.equal(providerCalls, 0);
});

test("streamed bodies that exceed the limit reject before RevenueCat and OpenRouter", async () => {
  for (const headers of [{}, { "content-length": "1" }] as Record<
    string,
    string
  >[]) {
    let entitlementChecks = 0;
    let usageClaims = 0;
    let providerCalls = 0;
    const response = await handleConversationRequest(
      streamedRequest(
        [new Uint8Array(MAX_REQUEST_BODY_BYTES), new Uint8Array([123])],
        headers,
      ),
      "key",
      {
        entitlementVerifier: {
          verifyAccess: async () => {
            entitlementChecks++;
            return { hasActivePro: true, plan: "monthly" };
          },
        },
        usageLimiter: {
          reserve: async () => {
            usageClaims++;
            return testLease();
          },
          settle: async () => settled(),
        },
        fetchImpl: async () => {
          providerCalls++;
          return provider(result)(new Request("http://localhost"));
        },
      },
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "payload_too_large");
    assert.equal(entitlementChecks, 0);
    assert.equal(usageClaims, 0);
    assert.equal(providerCalls, 0);
  }
});

test("a body exactly at the byte boundary is parsed and malformed JSON remains a 400", async () => {
  const response = await handleConversationRequest(
    streamedRequest([new Uint8Array(MAX_REQUEST_BODY_BYTES).fill(0x20)]),
    "key",
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_request");
});

test("CORS and invalid requests never call the provider", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("must not call");
  };
  for (const [req, status] of [
    [new Request("http://localhost", { method: "OPTIONS" }), 200],
    [new Request("http://localhost"), 405],
    [request({ transcriptText: "old transcript" }), 400],
    [
      new Request("http://localhost", {
        method: "POST",
        headers: { authorization: "Bearer signed-user" },
        body: "{",
      }),
      400,
    ],
  ] as const)
    assert.equal(
      (await handleConversationRequest(req, "key", { fetchImpl })).status,
      status,
    );
});
test("unusable screenshot, invalid structured output and provider error are terminal errors", async () => {
  for (const [value, status] of [
    [{ replyable: false, vibeCheck: null, replies: [] }, 422],
    [{ ...result, replies: [] }, 502],
  ] as const)
    assert.equal(
      (
        await handleConversationRequest(request(), "key", {
          fetchImpl: provider(value),
        })
      ).status,
      status,
    );
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: async () => new Response("sensitive", { status: 500 }),
  });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes("sensitive"));
});
test("technically valid replies pass through unchanged with one provider call", async () => {
  // These fixtures test the transport boundary, not the quality of Gemini's grounding.
  for (const text of [
    "Should we meet at the cafe?",
    "Can we go for coffee?",
    "I have two rescue dogs.",
    "I work in a hospital.",
    "Jeg bor i København.",
    "How about coffee, Alex?",
  ]) {
    for (const extraContext of [
      undefined,
      "",
      "Keep it playful",
      "ME: I have two rescue dogs.",
    ]) {
      const value = { ...result, replies: [text] };
      let calls = 0;
      const response = await handleConversationRequest(
        request({ ...input, extraContext }),
        "key",
        {
          fetchImpl: async (...args) => {
            calls++;
            return provider(value)(...args);
          },
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), value);
      assert.equal(calls, 1);
    }
  }
});

test("endpoint keeps provider diagnostics in logs and out of the response", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: async () =>
      new Response("PRIVATE IMAGE AND CHAT", { status: 402 }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "provider");
  assert.equal(body.providerStatus, undefined);
  assert.equal(body.providerReason, undefined);
  assert.match(body.error, /could not analyze/);
  assert.deepEqual(warn.mock.calls[0].arguments, [
    "[Wingr AI] request failed",
    {
      code: "provider",
      providerStatus: 402,
      providerReason: undefined,
      reason: undefined,
    },
  ]);
  assert.ok(!JSON.stringify(body).includes("PRIVATE"));
});

test("semantic failures preserve 422 and return only a validated reason", async () => {
  for (const reason of [
    "unreadable_image",
    "no_conversation",
    "ownership_unclear",
    "no_replyable_message",
  ] as const) {
    let calls = 0;
    const response = await handleConversationRequest(request(), "key", {
      fetchImpl: async (...args) => {
        calls++;
        return provider({
          replyable: false,
          failureReason: reason,
          vibeCheck: null,
          replies: [],
        })(...args);
      },
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      code: "unusable_screenshot",
      error:
        "WiNGR could not find a readable conversation to reply to. Try another screenshot.",
      reason,
    });
    assert.equal(calls, 1);
  }
  for (const failureReason of [undefined, null, "invalid"]) {
    const value = {
      replyable: false,
      vibeCheck: null,
      replies: [],
      ...(failureReason === undefined ? {} : { failureReason }),
    };
    const response = await handleConversationRequest(request(), "key", {
      fetchImpl: provider(value),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).reason, "unknown");
  }
});

test("every provider dispatch reserves once and settles once with the matching outcome", async () => {
  const unusable = (failureReason: string) => ({
    replyable: false,
    failureReason,
    vibeCheck: null,
    replies: [],
  });
  const scenarios: [unknown, number, SettlementOutcome][] = [
    [result, 200, "success"],
    [unusable("unreadable_image"), 422, "invalid_screenshot"],
    [unusable("no_conversation"), 422, "invalid_screenshot"],
    [unusable("ownership_unclear"), 422, "failure"],
    [unusable("no_replyable_message"), 422, "failure"],
    [unusable("unknown"), 422, "failure"],
    [{ replyable: false, vibeCheck: null, replies: [] }, 422, "failure"],
    [{ ...result, replies: [] }, 502, "failure"],
  ];
  for (const [value, status, expected] of scenarios) {
    const calls: unknown[][] = [];
    let reserves = 0;
    let providerCalls = 0;
    const response = await handleConversationRequest(request(), "key", {
      usageLimiter: {
        reserve: async () => {
          reserves++;
          return testLease();
        },
        settle: async (...args) => {
          calls.push(args);
          return settled();
        },
      },
      fetchImpl: async (...args) => {
        providerCalls++;
        return provider(value)(...args);
      },
    });
    assert.equal(response.status, status);
    assert.equal(reserves, 1);
    assert.equal(providerCalls, 1);
    assert.deepEqual(calls, [["Bearer signed-user", TEST_LEASE_ID, expected]]);
  }
});

test("failures before provider dispatch neither reserve nor settle", async () => {
  let reserves = 0;
  let settles = 0;
  let calls = 0;
  const usageLimiter: UsageLimiter = {
    reserve: async () => {
      reserves++;
      return testLease();
    },
    settle: async () => {
      settles++;
      return settled();
    },
  };
  const fetchImpl: typeof fetch = async () => {
    calls++;
    return provider(result)(new Request("http://localhost"));
  };
  assert.equal(
    (
      await handleConversationRequest(
        request({ ...input, screenshot: "not an image" }),
        "key",
        { fetchImpl, usageLimiter },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleConversationRequest(request(), "", {
        fetchImpl,
        usageLimiter,
      })
    ).status,
    502,
  );
  assert.equal(reserves, 0);
  assert.equal(settles, 0);
  assert.equal(calls, 0);
});

test("a limit rejection reserves nothing, so it is never settled or charged", async () => {
  let settles = 0;
  let calls = 0;
  const response = await handleConversationRequest(request(), "key", {
    usageLimiter: {
      reserve: async () => {
        throw new ConversationError(
          "usage_limit",
          undefined,
          undefined,
          "2026-10-09T14:34:00Z",
        );
      },
      settle: async () => {
        settles++;
        return settled();
      },
    },
    fetchImpl: async (...args) => {
      calls++;
      return provider(result)(...args);
    },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    code: "usage_limit",
    error: "You’ve reached your reply limit. Please check back later.",
    retryAt: "2026-10-09T14:34:00.000Z",
  });
  assert.equal(calls, 0);
  assert.equal(settles, 0);
});

test("the Weekly limit allows attempt 125 and rejects attempt 126 before OpenRouter", async () => {
  const authorization = "Bearer signed-user";
  const guard = createInMemoryGuard({ [authorization]: 124 });
  const weeklyVerifier = {
    verifyAccess: async () => ({
      hasActivePro: true as const,
      plan: "weekly" as const,
    }),
  };
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  };

  const attempt125 = await handleConversationRequest(request(), "key", {
    entitlementVerifier: weeklyVerifier,
    usageLimiter: guard.limiter,
    fetchImpl,
  });
  const attempt126 = await handleConversationRequest(request(), "key", {
    entitlementVerifier: weeklyVerifier,
    usageLimiter: guard.limiter,
    fetchImpl,
  });

  assert.equal(attempt125.status, 200);
  assert.equal(attempt126.status, 429);
  assert.equal((await attempt126.json()).code, "usage_limit");
  assert.equal(guard.attemptsFor(authorization), 125);
  assert.equal(providerCalls, 1);
});

test("10 and 50 parallel requests for one user dispatch exactly once", async () => {
  for (const count of [10, 50]) {
    const authorization = "Bearer same-user";
    const guard = createInMemoryGuard();
    const providerGate = deferred<Response>();
    let providerCalls = 0;
    const pending = Promise.all(
      Array.from({ length: count }, () =>
        handleConversationRequest(requestForUser("same-user"), "key", {
          usageLimiter: guard.limiter,
          fetchImpl: async () => {
            providerCalls++;
            return providerGate.promise;
          },
        }),
      ),
    );

    await nextTurn();
    assert.equal(providerCalls, 1);
    // Reserved but not charged while the generation is in flight.
    assert.equal(guard.attemptsFor(authorization), 0);
    assert.equal(guard.active.size, 1);
    providerGate.resolve(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(providerResult) },
          },
        ],
      }),
    );
    const responses = await pending;
    assert.equal(responses.filter(({ status }) => status === 200).length, 1);
    assert.equal(
      responses.filter(({ status }) => status === 429).length,
      count - 1,
    );
    const rejection = responses.find(({ status }) => status === 429)!;
    assert.equal(
      (await rejection.clone().json()).code,
      "generation_in_progress",
    );
    assert.match(rejection.headers.get("retry-after") ?? "", /^\d+$/);
    assert.equal(guard.active.size, 0);
    // Exactly one charge, however many requests raced.
    assert.equal(guard.attemptsFor(authorization), 1);
    assert.equal(guard.settlements.length, 1);
  }
});

test("parallel requests allow one active generation independently per user", async () => {
  const guard = createInMemoryGuard();
  const providerGate = deferred<void>();
  let providerCalls = 0;
  const users = ["user-a", "user-b"];
  const userIds: Record<string, string> = {
    "user-a": "00000000-0000-4000-8000-000000000011",
    "user-b": "00000000-0000-4000-8000-000000000012",
  };
  const pending = Promise.all(
    users.flatMap((user) =>
      Array.from({ length: 10 }, () =>
        handleConversationRequest(requestForUser(user), "key", {
          getVerifiedUserId: async (accessToken) =>
            userIds[accessToken] ?? null,
          usageLimiter: guard.limiter,
          fetchImpl: async () => {
            providerCalls++;
            await providerGate.promise;
            return provider(result)(new Request("http://localhost"));
          },
        }),
      ),
    ),
  );

  await nextTurn();
  assert.equal(providerCalls, 2);
  assert.equal(guard.active.size, 2);
  providerGate.resolve();
  const responses = await pending;
  assert.equal(guard.attemptsFor("Bearer user-a"), 1);
  assert.equal(guard.attemptsFor("Bearer user-b"), 1);
  assert.equal(responses.filter(({ status }) => status === 200).length, 2);
  assert.equal(responses.filter(({ status }) => status === 429).length, 18);
});

test("499 attempts plus concurrent requests permits only attempt 500", async () => {
  const authorization = "Bearer near-limit";
  const guard = createInMemoryGuard({ [authorization]: 499 });
  const providerGate = deferred<Response>();
  let providerCalls = 0;
  const pending = Promise.all(
    Array.from({ length: 20 }, () =>
      handleConversationRequest(requestForUser("near-limit"), "key", {
        usageLimiter: guard.limiter,
        fetchImpl: async () => {
          providerCalls++;
          return providerGate.promise;
        },
      }),
    ),
  );

  await nextTurn();
  assert.equal(providerCalls, 1);
  assert.equal(guard.attemptsFor(authorization), 499);
  providerGate.resolve(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(providerResult) },
        },
      ],
    }),
  );
  const responses = await pending;
  assert.equal(responses.filter(({ status }) => status === 200).length, 1);
  assert.equal(responses.filter(({ status }) => status === 429).length, 19);
  assert.equal(guard.attemptsFor(authorization), 500);

  // The next request is refused at the limit without dispatching.
  const afterLimit = await handleConversationRequest(
    requestForUser("near-limit"),
    "key",
    { usageLimiter: guard.limiter, fetchImpl: provider(result) },
  );
  assert.equal(afterLimit.status, 429);
  assert.equal((await afterLimit.json()).code, "usage_limit");
});

test("500 attempts fail closed without a lease or provider dispatch", async () => {
  const authorization = "Bearer at-limit";
  const guard = createInMemoryGuard({ [authorization]: 500 });
  let providerCalls = 0;
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      handleConversationRequest(requestForUser("at-limit"), "key", {
        usageLimiter: guard.limiter,
        fetchImpl: async (...args) => {
          providerCalls++;
          return provider(result)(...args);
        },
      }),
    ),
  );
  assert.equal(providerCalls, 0);
  assert.equal(guard.attemptsFor(authorization), 500);
  assert.equal(guard.active.size, 0);
  assert.ok(responses.every(({ status }) => status === 429));
  assert.ok(
    (await Promise.all(responses.map((response) => response.json()))).every(
      ({ code }) => code === "usage_limit",
    ),
  );
});

test("technical failures settle as free after provider failure, timeout and client abort", async () => {
  for (const scenario of ["provider", "timeout", "invalid_json"] as const) {
    const outcomes: SettlementOutcome[] = [];
    const response = await handleConversationRequest(request(), "key", {
      usageLimiter: {
        reserve: async () => testLease(),
        settle: async (_authorization, _leaseId, outcome) => {
          outcomes.push(outcome);
          return settled(false);
        },
      },
      timeoutMs: 5,
      fetchImpl:
        scenario === "provider"
          ? async () => new Response(null, { status: 503 })
          : scenario === "invalid_json"
            ? async () =>
                Response.json({
                  choices: [
                    {
                      finish_reason: "stop",
                      message: { content: "{ not json" },
                    },
                  ],
                })
            : async (_url, init) =>
                await new Promise<Response>((_resolve, reject) => {
                  init?.signal?.addEventListener(
                    "abort",
                    () => reject(new DOMException("Aborted", "AbortError")),
                    { once: true },
                  );
                }),
    });
    assert.equal(response.status, scenario === "timeout" ? 504 : 502, scenario);
    assert.deepEqual(outcomes, ["failure"], scenario);
  }
});

test("missing or failed acquisition protection fails closed before OpenRouter", async () => {
  for (const usageLimiter of [
    undefined,
    {
      reserve: async () => {
        throw new ConversationError("generation_protection_unavailable");
      },
      settle: async () => settled(),
    } satisfies UsageLimiter,
  ]) {
    let providerCalls = 0;
    const response = await handleConversationRequestCore(request(), "key", {
      entitlementVerifier: {
        verifyAccess: async () => ({ hasActivePro: true, plan: "monthly" }),
      },
      getVerifiedUserId: async () => AUTHENTICATED_USER_ID,
      usageLimiter,
      fetchImpl: async (...args) => {
        providerCalls++;
        return provider(result)(...args);
      },
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).code,
      "generation_protection_unavailable",
    );
    assert.equal(providerCalls, 0);
  }
});

test("a settlement failure never replaces a valid reply and is logged without identifiers", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const info = t.mock.method(console, "info", () => {});
  let settleCalls = 0;
  const response = await handleConversationRequest(request(), "key", {
    usageLimiter: {
      reserve: async () => testLease(),
      settle: async () => {
        settleCalls++;
        throw new ConversationError("generation_protection_unavailable");
      },
    },
    fetchImpl: provider(result),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  // Settlement is attempted exactly once and never retried.
  assert.equal(settleCalls, 1);
  assert.deepEqual(warn.mock.calls[0].arguments, [
    "[Wingr AI] generation settlement failed",
    { code: "generation_settlement_failed", settlement: "success" },
  ]);
  const call = info.mock.calls.find(
    ({ arguments: [event] }) => event === "[Wingr AI] generation settlement",
  );
  const fields = call?.arguments[1] as Record<string, unknown>;
  assert.equal(fields.result, "failed");
  assert.equal(fields.charged, null);
  assert.ok(
    !JSON.stringify([warn.mock.calls, info.mock.calls]).includes(TEST_LEASE_ID),
  );
});

test("a settlement failure after an unusable screenshot still returns the 422", async (t) => {
  t.mock.method(console, "warn", () => {});
  const response = await handleConversationRequest(request(), "key", {
    usageLimiter: {
      reserve: async () => testLease(),
      settle: async () => {
        throw new Error("database unavailable");
      },
    },
    fetchImpl: provider({
      replyable: false,
      failureReason: "unreadable_image",
      vibeCheck: null,
      replies: [],
    }),
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "unusable_screenshot");
});

test("the reply is returned only after settlement has completed", async () => {
  const order: string[] = [];
  const gate = deferred<void>();
  const pending = handleConversationRequest(request(), "key", {
    usageLimiter: {
      reserve: async () => testLease(),
      settle: async () => {
        order.push("settle-start");
        await gate.promise;
        order.push("settle-end");
        return settled();
      },
    },
    fetchImpl: provider(result),
  }).then((response) => {
    order.push("response");
    return response;
  });
  await nextTurn();
  assert.deepEqual(order, ["settle-start"]);
  gate.resolve();
  assert.equal((await pending).status, 200);
  assert.deepEqual(order, ["settle-start", "settle-end", "response"]);
});

test("settlement telemetry contains only fixed fields", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: provider(result),
  });

  assert.equal(response.status, 200);
  const call = info.mock.calls.find(
    ({ arguments: [event] }) => event === "[Wingr AI] generation settlement",
  );
  assert.ok(call);
  const fields = call.arguments[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(fields).sort(), [
    "charged",
    "durationMs",
    "event",
    "generation",
    "result",
    "settlement",
  ]);
  assert.equal(fields.event, "ai_generation_settlement");
  assert.equal(fields.generation, "subscription");
  assert.equal(fields.result, "applied");
  assert.equal(fields.settlement, "success");
  assert.equal(fields.charged, true);
  assert.equal(typeof fields.durationMs, "number");
});

test("a successful reply costs one attempt and a technical failure costs none", async () => {
  const authorization = "Bearer signed-user";
  const guard = createInMemoryGuard();
  const run = (fetchImpl: typeof fetch) =>
    handleConversationRequest(request(), "key", {
      usageLimiter: guard.limiter,
      fetchImpl,
    });
  assert.equal((await run(provider(result))).status, 200);
  assert.equal(guard.attemptsFor(authorization), 1);
  assert.equal(
    (await run(async () => new Response(null, { status: 503 }))).status,
    502,
  );
  assert.equal((await run(provider({ ...result, replies: [] }))).status, 502);
  assert.equal(guard.attemptsFor(authorization), 1);
  assert.equal(guard.active.size, 0);
});

test("every fifth invalid screenshot costs one attempt and counters persist across requests", async () => {
  const authorization = "Bearer signed-user";
  const guard = createInMemoryGuard();
  const screenshot = (failureReason: string) =>
    provider({
      replyable: false,
      failureReason,
      vibeCheck: null,
      replies: [],
    });
  const reasons = [
    "unreadable_image",
    "no_conversation",
    "unreadable_image",
    "no_conversation",
  ];
  for (const reason of reasons) {
    const response = await handleConversationRequest(request(), "key", {
      usageLimiter: guard.limiter,
      fetchImpl: screenshot(reason),
    });
    assert.equal(response.status, 422);
  }
  assert.equal(guard.attemptsFor(authorization), 0);
  assert.equal(guard.invalidPendingFor(authorization), 4);

  // Free rejections and technical failures do not advance the counter.
  for (const reason of ["ownership_unclear", "no_replyable_message", "unknown"])
    await handleConversationRequest(request(), "key", {
      usageLimiter: guard.limiter,
      fetchImpl: screenshot(reason),
    });
  await handleConversationRequest(request(), "key", {
    usageLimiter: guard.limiter,
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.equal(guard.invalidPendingFor(authorization), 4);
  assert.equal(guard.attemptsFor(authorization), 0);

  await handleConversationRequest(request(), "key", {
    usageLimiter: guard.limiter,
    fetchImpl: screenshot("unreadable_image"),
  });
  assert.equal(guard.attemptsFor(authorization), 1);
  assert.equal(guard.invalidPendingFor(authorization), 0);

  // A success never touches the invalid-screenshot counter.
  await handleConversationRequest(request(), "key", {
    usageLimiter: guard.limiter,
    fetchImpl: screenshot("no_conversation"),
  });
  await handleConversationRequest(request(), "key", {
    usageLimiter: guard.limiter,
    fetchImpl: provider(result),
  });
  assert.equal(guard.invalidPendingFor(authorization), 1);
  assert.equal(guard.attemptsFor(authorization), 2);
});

test("stage latency telemetry contains only fixed performance fields", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: provider(result),
  });

  assert.equal(response.status, 200);
  const call = info.mock.calls.find(
    ({ arguments: [event] }) => event === "[Wingr AI] generation stage latency",
  );
  assert.ok(call);
  const fields = call.arguments[1] as Record<string, unknown>;
  assert.deepEqual(Object.keys(fields).sort(), [
    "bodyMs",
    "claimMs",
    "entitlementWaitMs",
    "event",
    "generation",
    "model",
    "outcome",
    "providerMs",
    "reasoningEffort",
    "totalMs",
  ]);
  assert.equal(fields.reasoningEffort, "low");
  assert.equal(fields.model, "google/gemini-3.8-flash");
  assert.equal(fields.event, "ai_generation_stage_latency");
  assert.equal(fields.outcome, "success");
  for (const key of ["bodyMs", "claimMs", "providerMs", "totalMs"])
    assert.equal(typeof fields[key], "number");
});

test("a failed provider call still reports stage latency with a failure outcome", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: async () => new Response(null, { status: 503 }),
  });

  assert.equal(response.status, 502);
  const call = info.mock.calls.find(
    ({ arguments: [event] }) => event === "[Wingr AI] generation stage latency",
  );
  assert.equal((call?.arguments[1] as { outcome: string }).outcome, "failure");
});

test("low reasoning is the default and medium can be selected by configuration", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  const efforts: unknown[] = [];
  const capture = async (_url: unknown, init?: RequestInit) => {
    efforts.push(JSON.parse(String(init?.body)).reasoning);
    return provider(result)(_url as never, init);
  };
  const byDefault = await handleConversationRequest(request(), "key", {
    fetchImpl: capture,
  });
  const medium = await handleConversationRequest(request(), "key", {
    reasoningEffort: "medium",
    fetchImpl: capture,
  });

  assert.equal(byDefault.status, 200);
  assert.equal(medium.status, 200);
  assert.deepEqual(efforts, [{ effort: "low" }, { effort: "medium" }]);
  const logged = info.mock.calls
    .filter(
      ({ arguments: [event] }) =>
        event === "[Wingr AI] generation stage latency",
    )
    .map(
      ({ arguments: [, details] }) =>
        (details as { reasoningEffort: string }).reasoningEffort,
    );
  assert.deepEqual(logged, ["low", "medium"]);
});

test("the handler sends the configured model and provider and logs only those fixed strings", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  let sent: { model?: string; provider?: { only?: string[] } } = {};
  const response = await handleConversationRequest(request(), "key", {
    model: DEEPSEEK_MODEL,
    fetchImpl: async (url, init) => {
      sent = JSON.parse(String(init?.body));
      return provider(result)(url as never, init);
    },
  });

  assert.equal(response.status, 200);
  assert.equal(sent.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.deepEqual(sent.provider?.only, ["inference-net/fp8"]);
  const find = (name: string) =>
    info.mock.calls.find(({ arguments: [event] }) => event === name)!
      .arguments[1] as Record<string, unknown>;
  assert.equal(find("[Wingr AI] provider latency").model, DEEPSEEK_MODEL);
  assert.equal(
    find("[Wingr AI] provider latency").provider,
    "inference-net/fp8",
  );
  assert.equal(
    find("[Wingr AI] generation stage latency").model,
    DEEPSEEK_MODEL,
  );
});

test("without a model option the handler stays on Gemini through Vertex", async () => {
  let sent: { model?: string; provider?: { only?: string[] } } = {};
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: async (url, init) => {
      sent = JSON.parse(String(init?.body));
      return provider(result)(url as never, init);
    },
  });
  assert.equal(response.status, 200);
  assert.equal(sent.model, "google/gemini-3.8-flash");
  assert.deepEqual(sent.provider?.only, ["google-vertex/global"]);
});
