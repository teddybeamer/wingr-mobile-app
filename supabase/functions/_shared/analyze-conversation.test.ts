import assert from "node:assert/strict";
import test from "node:test";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { ConversationError } from "./conversation.ts";
import { input, result } from "./test-fixtures.ts";

const request = (body: unknown = input) =>
  new Request("http://localhost/ai-conversation", {
    method: "POST",
    body: JSON.stringify(body),
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
test("CORS and invalid requests never call the provider", async () => {
  const fetchImpl: typeof fetch = async () => {
    throw new Error("must not call");
  };
  for (const [req, status] of [
    [new Request("http://localhost", { method: "OPTIONS" }), 200],
    [new Request("http://localhost"), 405],
    [request({ transcriptText: "old transcript" }), 400],
    [new Request("http://localhost", { method: "POST", body: "{" }), 400],
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
  assert.equal((await handleConversationRequest(request(), "", { fetchImpl, usageLimiter })).status, 502);
  assert.equal(claims, 0);
  assert.equal(calls, 0);
});

test("the usage limit rejects before Gemini, including concurrent requests", async () => {
  let used = 499;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {
      await Promise.resolve();
      if (used >= 500) throw new ConversationError("usage_limit", undefined, undefined, "2026-10-09T14:34:00Z");
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
  assert.equal(responses.filter((response) => response.status === 200).length, 500);
  assert.equal(responses.filter((response) => response.status === 429).length, 1);
  assert.equal(calls, 500);
});

test("onboarding claims are one-time, count as normal attempts and reject before Gemini", async () => {
  let onboardingClaimed = false;
  let onboardingClaims = 0;
  let normalAttempts = 0;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {
      normalAttempts++;
    },
    claimOnboarding: async () => {
      if (onboardingClaimed) throw new ConversationError("onboarding_reply_used");
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
    usageLimiter,
    fetchImpl,
  });
  const second = await handleConversationRequest(onboardingRequest(), "key", {
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
  assert.equal(calls, 1);
});

test("an unusable onboarding completion and concurrent requests still consume one allowance", async () => {
  let onboardingClaimed = false;
  let calls = 0;
  const usageLimiter = {
    claim: async () => {},
    claimOnboarding: async () => {
      await Promise.resolve();
      if (onboardingClaimed) throw new ConversationError("onboarding_reply_used");
      onboardingClaimed = true;
    },
  };
  const onboardingRequest = () =>
    request({ ...input, isOnboardingGeneration: true });
  const unusable = await handleConversationRequest(onboardingRequest(), "key", {
    usageLimiter,
    fetchImpl: async (...args) => {
      calls++;
      return provider({ messages: [], replyable: false, vibeCheck: null, replies: [] })(
        ...args,
      );
    },
  });
  const afterUnusable = await handleConversationRequest(onboardingRequest(), "key", {
    usageLimiter,
    fetchImpl: async (...args) => {
      calls++;
      return provider(result)(...args);
    },
  });
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
  assert.equal(concurrent.filter((response) => response.status === 200).length, 1);
  assert.equal(concurrent.filter((response) => response.status === 409).length, 1);
  assert.equal(calls, 1);
});
