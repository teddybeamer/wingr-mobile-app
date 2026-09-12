import assert from "node:assert/strict";
import test from "node:test";
import {
  handleConversationRequest as handleConversationRequestCore,
  MAX_REQUEST_BODY_BYTES,
  type ConversationHandlerOptions,
} from "./analyze-conversation.ts";
import { ConversationError } from "./conversation.ts";
import { createRevenueCatEntitlementVerifier } from "./revenuecat-entitlement.ts";
import { input, result } from "./test-fixtures.ts";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown = input) =>
  new Request("http://localhost/ai-conversation", {
    method: "POST",
    headers: { authorization: "Bearer signed-user" },
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
      hasActivePro: async () => true,
    },
    getVerifiedUserId: async () => AUTHENTICATED_USER_ID,
    ...options,
  });
const provider =
  (value: unknown): typeof fetch =>
  async () =>
    Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    });
test("endpoint returns messages, vibe and reply from one call compatible with the app", async () => {
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
      hasActivePro: async (appUserId) => {
        assert.equal(appUserId, AUTHENTICATED_USER_ID);
        order.push("entitlement");
        return true;
      },
    },
    usageLimiter: {
      claim: async () => {
        order.push("usage");
      },
      claimOnboarding: async () => {
        throw new Error("must not use the onboarding claim");
      },
    },
    fetchImpl: async (...args) => {
      order.push("openrouter");
      return provider(result)(...args);
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(order, ["auth", "entitlement", "usage", "openrouter"]);
});

test("missing pro returns subscription_required without usage or OpenRouter", async () => {
  let usageClaims = 0;
  let providerCalls = 0;
  const response = await handleConversationRequest(request(), "key", {
    entitlementVerifier: {
      hasActivePro: async () => false,
    },
    usageLimiter: {
      claim: async () => {
        usageClaims++;
      },
      claimOnboarding: async () => {},
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
    projectId: "proj_wingr",
    proEntitlementResourceId: "entl_pro",
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
      claim: async () => {
        usageClaims++;
      },
      claimOnboarding: async () => {},
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
        hasActivePro: async (appUserId) => {
          checkedUsers.push(appUserId);
          return false;
        },
      },
      usageLimiter: {
        claim: async () => {
          usageClaims++;
        },
        claimOnboarding: async () => {},
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
        hasActivePro: async () => {
          throw failure;
        },
      },
      usageLimiter: {
        claim: async () => {
          usageClaims++;
        },
        claimOnboarding: async () => {},
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
        hasActivePro: async () => {
          entitlementChecks++;
          return true;
        },
      },
      usageLimiter: {
        claim: async () => {
          usageClaims++;
        },
        claimOnboarding: async () => {},
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
      hasActivePro: async () => {
        entitlementChecks++;
        return true;
      },
    },
    usageLimiter: {
      claim: async () => {
        usageClaims++;
      },
      claimOnboarding: async () => {
        usageClaims++;
      },
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
  for (const headers of [
    {},
    { "content-length": "1" },
  ] as Record<string, string>[]) {
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
          hasActivePro: async () => {
            entitlementChecks++;
            return true;
          },
        },
        usageLimiter: {
          claim: async () => {
            usageClaims++;
          },
          claimOnboarding: async () => {
            usageClaims++;
          },
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
    [{ messages: [], replyable: false, vibeCheck: null, replies: [] }, 422],
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
test("technically valid replies and attribution pass through unchanged with one provider call", async () => {
  // These fixtures test the transport boundary, not the quality of Gemini's grounding.
  for (const text of [
    "Should we meet at the cafe?",
    "Can we go for coffee?",
    "I have two rescue dogs.",
    "I work in a hospital.",
    "Jeg bor i København.",
    "How about coffee, Alex?",
  ]) {
    for (const speaker of ["ME", "THEM"]) {
      for (const extraContext of [
        undefined,
        "",
        "Keep it playful",
        "ME: I have two rescue dogs.",
      ]) {
        const value = {
          ...result,
          messages: [{ speaker, text: "I have two rescue dogs." }],
          replies: [text],
        };
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
  }
});

test("endpoint exposes and logs only safe error codes and provider status", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const response = await handleConversationRequest(request(), "key", {
    fetchImpl: async () =>
      new Response("PRIVATE IMAGE AND CHAT", { status: 402 }),
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "provider");
  assert.equal(body.providerStatus, 402);
  assert.match(body.error, /insufficient credits/);
  assert.deepEqual(warn.mock.calls[0].arguments, [
    "[Wingr AI] request failed",
    { code: "provider", providerStatus: 402, providerReason: undefined },
  ]);
  assert.ok(!JSON.stringify(body).includes("PRIVATE"));
});

test("provider dispatch permanently claims usage for successful and unusable model results", async () => {
  for (const value of [
    result,
    { messages: [], replyable: false, vibeCheck: null, replies: [] },
    { ...result, replies: [] },
  ]) {
    let claims = 0;
    let calls = 0;
    const response = await handleConversationRequest(request(), "key", {
      usageLimiter: {
        claim: async () => {
          claims++;
        },
        claimOnboarding: async () => {},
      },
      fetchImpl: async (...args) => {
        calls++;
        return provider(value)(...args);
      },
    });
    assert.ok([200, 422, 502].includes(response.status));
    assert.equal(claims, 1);
    assert.equal(calls, 1);
  }
});

test("failures before provider dispatch do not claim usage", async () => {
  let claims = 0;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {
      claims++;
    },
    claimOnboarding: async () => {},
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
  assert.equal(claims, 0);
  assert.equal(calls, 0);
});

test("the usage limit rejects before Gemini, including concurrent requests", async () => {
  let used = 499;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {
      await Promise.resolve();
      if (used >= 500)
        throw new ConversationError(
          "usage_limit",
          undefined,
          undefined,
          "2026-10-09T14:34:00Z",
        );
      used++;
    },
    claimOnboarding: async () => {},
  };
  const first = await handleConversationRequest(request(), "key", {
    usageLimiter,
    fetchImpl: async (...args) => {
      calls++;
      return provider(result)(...args);
    },
  });
  const second = await handleConversationRequest(request(), "key", {
    usageLimiter,
    fetchImpl: async (...args) => {
      calls++;
      return provider(result)(...args);
    },
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.deepEqual(await second.json(), {
    code: "usage_limit",
    error: "You’ve reached your reply limit. Please check back later.",
    retryAt: "2026-10-09T14:34:00.000Z",
  });
  assert.equal(calls, 1);

  used = 0;
  calls = 0;
  const responses = await Promise.all(
    Array.from({ length: 501 }, () =>
      handleConversationRequest(request(), "key", {
        usageLimiter,
        fetchImpl: async (...args) => {
          calls++;
          return provider(result)(...args);
        },
      }),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    500,
  );
  assert.equal(
    responses.filter((response) => response.status === 429).length,
    1,
  );
  assert.equal(calls, 500);
});

test("onboarding claims are one-time, count as normal attempts and reject before Gemini", async () => {
  let onboardingClaimed = false;
  let onboardingClaims = 0;
  let normalAttempts = 0;
  let entitlementChecks = 0;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {
      normalAttempts++;
    },
    claimOnboarding: async () => {
      if (onboardingClaimed)
        throw new ConversationError("onboarding_reply_used");
      onboardingClaimed = true;
      onboardingClaims++;
      normalAttempts++;
    },
  };
  const onboardingRequest = () =>
    request({ ...input, isOnboardingGeneration: true });
  const fetchImpl: typeof fetch = async (...args) => {
    calls++;
    return provider(result)(...args);
  };
  const first = await handleConversationRequest(onboardingRequest(), "key", {
    entitlementVerifier: {
      hasActivePro: async () => {
        entitlementChecks++;
        return false;
      },
    },
    usageLimiter,
    fetchImpl,
  });
  const second = await handleConversationRequest(onboardingRequest(), "key", {
    entitlementVerifier: {
      hasActivePro: async () => {
        entitlementChecks++;
        return false;
      },
    },
    usageLimiter,
    fetchImpl,
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), {
    code: "onboarding_reply_used",
    error: "You've already used your free onboarding reply.",
  });
  assert.equal(onboardingClaims, 1);
  assert.equal(normalAttempts, 1);
  assert.equal(entitlementChecks, 0);
  assert.equal(calls, 1);
});

test("an unusable onboarding completion and concurrent requests still consume one allowance", async () => {
  let onboardingClaimed = false;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {},
    claimOnboarding: async () => {
      await Promise.resolve();
      if (onboardingClaimed)
        throw new ConversationError("onboarding_reply_used");
      onboardingClaimed = true;
    },
  };
  const onboardingRequest = () =>
    request({ ...input, isOnboardingGeneration: true });
  const unusable = await handleConversationRequest(onboardingRequest(), "key", {
    usageLimiter,
    fetchImpl: async (...args) => {
      calls++;
      return provider({
        messages: [],
        replyable: false,
        vibeCheck: null,
        replies: [],
      })(...args);
    },
  });
  const afterUnusable = await handleConversationRequest(
    onboardingRequest(),
    "key",
    {
      usageLimiter,
      fetchImpl: async (...args) => {
        calls++;
        return provider(result)(...args);
      },
    },
  );
  assert.equal(unusable.status, 422);
  assert.equal(afterUnusable.status, 409);
  assert.equal(calls, 1);

  onboardingClaimed = false;
  calls = 0;
  const concurrent = await Promise.all(
    [onboardingRequest(), onboardingRequest()].map((request) =>
      handleConversationRequest(request, "key", {
        usageLimiter,
        fetchImpl: async (...args) => {
          calls++;
          return provider(result)(...args);
        },
      }),
    ),
  );
  assert.equal(
    concurrent.filter((response) => response.status === 200).length,
    1,
  );
  assert.equal(
    concurrent.filter((response) => response.status === 409).length,
    1,
  );
  assert.equal(calls, 1);
});
