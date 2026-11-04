import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONSENT_CACHE_KEY,
  AI_CONSENT_TITLE,
  AI_CONSENT_PARAGRAPHS,
  AI_CONSENT_RECIPIENTS,
  AI_CONSENT_VERSION,
  createAiConsentController,
  type ConsentApi,
} from "./ai-consent";

function setup({
  cached,
  statusResult = true,
  userId = "user-1",
}: {
  cached?: { userId: string; version: string } | string;
  statusResult?: boolean | Error;
  userId?: string;
} = {}) {
  const store = new Map<string, string>();
  if (cached)
    store.set(
      AI_CONSENT_CACHE_KEY,
      typeof cached === "string" ? cached : JSON.stringify(cached),
    );
  const calls = { accept: 0, status: 0, withdraw: 0 };
  const api: ConsentApi = {
    accept: async () => {
      calls.accept++;
    },
    status: async () => {
      calls.status++;
      if (statusResult instanceof Error) throw statusResult;
      return statusResult;
    },
    withdraw: async () => {
      calls.withdraw++;
    },
  };
  const controller = createAiConsentController({
    api,
    getUserId: async () => userId,
    storage: async () => ({
      getItem: async (key) => store.get(key) ?? null,
      removeItem: async (key) => {
        store.delete(key);
      },
      setItem: async (key, value) => {
        store.set(key, value);
      },
    }),
  });
  return { calls, controller, store };
}

test("a valid cached consent for the same user and version needs no request", async () => {
  const { calls, controller } = setup({
    cached: { userId: "user-1", version: AI_CONSENT_VERSION },
  });
  assert.equal(await controller.check(), "granted");
  assert.equal(calls.status, 0);
});

test("a cache from another user or another consent version is ignored and the server decides", async () => {
  for (const cached of [
    { userId: "someone-else", version: AI_CONSENT_VERSION },
    { userId: "user-1", version: "an-older-version" },
    "not json",
  ]) {
    const { calls, controller } = setup({ cached });
    assert.equal(await controller.check(), "granted");
    assert.equal(calls.status, 1);
  }
});

test("the server saying no clears the cache and reports a missing consent", async () => {
  const { controller, store } = setup({
    cached: { userId: "user-1", version: AI_CONSENT_VERSION },
    statusResult: false,
  });
  assert.equal(await controller.check({ verifyWithServer: true }), "missing");
  assert.equal(store.has(AI_CONSENT_CACHE_KEY), false);
});

test("a granted answer from the server is cached for next time", async () => {
  const { calls, controller, store } = setup();
  assert.equal(await controller.check(), "granted");
  assert.equal(await controller.check(), "granted");
  assert.equal(calls.status, 1);
  assert.equal(
    JSON.parse(store.get(AI_CONSENT_CACHE_KEY)!).version,
    AI_CONSENT_VERSION,
  );
});

test("a server or network error is unavailable, never missing, and keeps the cache", async () => {
  const { controller, store } = setup({
    cached: { userId: "user-1", version: AI_CONSENT_VERSION },
    statusResult: new Error("offline"),
  });
  assert.equal(
    await controller.check({ verifyWithServer: true }),
    "unavailable",
  );
  assert.equal(store.has(AI_CONSENT_CACHE_KEY), true);

  const failing = createAiConsentController({
    api: {
      accept: async () => {},
      status: async () => true,
      withdraw: async () => {},
    },
    getUserId: async () => {
      throw new Error("no session");
    },
    storage: async () => ({
      getItem: async () => null,
      removeItem: async () => {},
      setItem: async () => {},
    }),
  });
  assert.equal(await failing.check(), "unavailable");
});

test("accepting caches the consent for the current user and withdrawing clears it", async () => {
  const { calls, controller, store } = setup();
  await controller.accept();
  assert.equal(calls.accept, 1);
  assert.deepEqual(JSON.parse(store.get(AI_CONSENT_CACHE_KEY)!), {
    userId: "user-1",
    version: AI_CONSENT_VERSION,
  });
  await controller.withdraw();
  assert.equal(calls.withdraw, 1);
  assert.equal(store.has(AI_CONSENT_CACHE_KEY), false);
});

test("a failed accept caches nothing", async () => {
  const { controller, store } = setup();
  const failing = createAiConsentController({
    api: {
      accept: async () => {
        throw new Error("rejected");
      },
      status: async () => true,
      withdraw: async () => {},
    },
    getUserId: async () => "user-1",
    storage: async () => ({
      getItem: async (key) => store.get(key) ?? null,
      removeItem: async (key) => {
        store.delete(key);
      },
      setItem: async (key, value) => {
        store.set(key, value);
      },
    }),
  });
  await assert.rejects(failing.accept());
  assert.equal(store.has(AI_CONSENT_CACHE_KEY), false);
  void controller;
});

test("invalidate forgets the cached consent", async () => {
  const { controller, store } = setup({
    cached: { userId: "user-1", version: AI_CONSENT_VERSION },
  });
  await controller.invalidate();
  assert.equal(store.has(AI_CONSENT_CACHE_KEY), false);
});

test("the consent text names exactly the recipients the server enforces and explains withdrawal", () => {
  const text = AI_CONSENT_PARAGRAPHS.join(" ");
  for (const recipient of AI_CONSENT_RECIPIENTS)
    assert.ok(text.includes(recipient));
  assert.ok(text.includes("OpenRouter and Google Vertex AI"));
  assert.ok(text.includes("change your mind anytime in the three-dot menu"));
  assert.ok(!/securely/i.test(text));
  assert.ok(!/inference/i.test(text));
});

test("the popup copy is exactly what the product specifies", () => {
  assert.equal(AI_CONSENT_TITLE, "Your chats. Your choice.");
  assert.deepEqual([...AI_CONSENT_PARAGRAPHS], [
    "WiNGR uses AI to read the vibe and help you craft better replies.",
    "Your screenshots and the conversations in them are shared with OpenRouter and Google Vertex AI to generate your replies.",
    "These providers may keep content for safety and abuse prevention, even after processing. According to their policies, it isn’t used to train AI models.",
    "Tap I Accept to allow this. You can change your mind anytime in the three-dot menu.",
  ]);
});

test("the consent text makes no zero-retention claim and discloses provider retention and training", () => {
  const text = AI_CONSENT_PARAGRAPHS.join(" ");
  assert.ok(!/zero data retention|\bZDR\b|zero.retention|no retention|not stored|never stored/i.test(text));
  assert.ok(/may keep content for safety and abuse prevention, even after processing/.test(text));
  assert.ok(/isn’t used to train AI models/.test(text));
  assert.ok(/conversations in them are shared with/.test(text));
});
