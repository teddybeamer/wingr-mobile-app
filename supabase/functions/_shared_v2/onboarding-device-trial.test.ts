import assert from "node:assert/strict";
import test from "node:test";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { ConversationError, parseConversationRequest } from "./conversation.ts";
import {
  createDeviceCheckOnboardingTrialManager,
  createTrialCipher,
  type OnboardingTrialStore,
} from "../_shared/onboarding-device-trial.ts";
import {
  asProviderResult,
  input,
  providerResult,
  result,
} from "./test-fixtures.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TRIAL_ID = "00000000-0000-4000-8000-000000000001";
const DEVICE_TOKEN = "dGVzdC1kZXZpY2UtdG9rZW4=";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

type StoredTrial = {
  ciphertext?: string;
  iv?: string;
  state: "generating" | "result_ready" | "finalized";
  userId: string;
};

function createStore(expectedUserId = USER_ID) {
  let record: StoredTrial | undefined;
  let claims = 0;
  let attempts = 0;
  const store: OnboardingTrialStore = {
    async abandon(userId, trialId) {
      if (
        record?.userId === userId &&
        trialId === TRIAL_ID &&
        record.state === "generating"
      )
        record = undefined;
    },
    async begin(userId, trialId) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record) {
        record = { state: "generating", userId };
        return { status: "started" };
      }
      if (record.state === "generating")
        return { status: "generation_in_progress" };
      return {
        status: record.state === "finalized" ? "replay" : "result_ready",
        ciphertext: record.ciphertext,
        iv: record.iv,
      };
    },
    async finalize(userId, trialId) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record || record.state === "generating")
        return { status: "trial_unavailable" };
      if (record.state === "finalized")
        return {
          status: "replay",
          ciphertext: record.ciphertext,
          iv: record.iv,
        };
      claims++;
      attempts++;
      record.state = "finalized";
      return {
        status: "finalized",
        ciphertext: record.ciphertext,
        iv: record.iv,
      };
    },
    async saveResult(userId, trialId, _hash, encrypted) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record || record.state !== "generating")
        return { status: "trial_unavailable" };
      record = { ...record, ...encrypted, state: "result_ready" };
      return { status: "result_ready" };
    },
  };
  return {
    attempts: () => attempts,
    claims: () => claims,
    record: () => record,
    store,
  };
}

function createDeviceCheck({
  failMarks = 0,
  queryError,
  used: initialUsed = false,
}: {
  failMarks?: number;
  queryError?: Error;
  used?: boolean;
} = {}) {
  let marks = 0;
  let used = initialUsed;
  return {
    deviceCheck: {
      async isOnboardingPreviewUsed() {
        if (queryError) throw queryError;
        return used;
      },
      async markOnboardingPreviewUsed() {
        marks++;
        if (marks <= failMarks) throw new Error("Apple unavailable");
        used = true;
      },
    },
    marks: () => marks,
  };
}

function deviceRequest() {
  return new Request("http://localhost/ai-conversation-v2", {
    method: "POST",
    headers: { authorization: "Bearer signed-user" },
    body: JSON.stringify({
      ...input,
      deviceCheckToken: DEVICE_TOKEN,
      isOnboardingGeneration: true,
      onboardingTrialId: TRIAL_ID,
    }),
  });
}

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

function createManager(
  store: OnboardingTrialStore,
  deviceCheck: ReturnType<typeof createDeviceCheck>["deviceCheck"],
) {
  return createDeviceCheckOnboardingTrialManager({
    cipher: createTrialCipher(KEY),
    deviceCheck,
    store,
  });
}

async function call(
  manager: ReturnType<typeof createManager>,
  fetchImpl: typeof fetch,
) {
  return handleConversationRequest(deviceRequest(), "key", {
    fetchImpl,
    getVerifiedUserId: async () => USER_ID,
    onboardingTrialManager: manager,
  });
}

test("a provider failure abandons the DeviceCheck lease without marking the device or allowance", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  let providerCalls = 0;
  const response = await call(
    createManager(memory.store, apple.deviceCheck),
    async () => {
      providerCalls++;
      throw new Error("network unavailable");
    },
  );

  assert.equal(response.status, 502);
  assert.equal(providerCalls, 1);
  assert.equal(memory.record(), undefined);
  assert.equal(memory.claims(), 0);
  assert.equal(memory.attempts(), 0);
  assert.equal(apple.marks(), 0);
});

test("a semantic screenshot failure abandons the free preview without consuming it", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  let providerCalls = 0;
  const response = await call(
    createManager(memory.store, apple.deviceCheck),
    async (...args) => {
      providerCalls++;
      return provider({
        replyable: false,
        failureReason: "no_conversation",
        vibeCheck: null,
        replies: [],
      })(...args);
    },
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).reason, "no_conversation");
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 0);
  assert.equal(memory.attempts(), 0);
  assert.equal(memory.record(), undefined);
  assert.equal(apple.marks(), 0);
});

test("a failed Apple finalization reuses the encrypted result without another Gemini call", async () => {
  const memory = createStore();
  const apple = createDeviceCheck({ failMarks: 1 });
  const manager = createManager(memory.store, apple.deviceCheck);
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  };

  const first = await call(manager, fetchImpl);
  assert.equal(first.status, 503);
  assert.equal(memory.record()?.state, "result_ready");
  assert.equal(memory.claims(), 0);

  const retry = await call(manager, fetchImpl);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), result);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  assert.equal(memory.attempts(), 1);

  const replay = await call(manager, fetchImpl);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  assert.equal(memory.attempts(), 1);
});

test("a used DeviceCheck bit produces the Pro continuation without Gemini", async () => {
  const memory = createStore();
  const apple = createDeviceCheck({ used: true });
  let providerCalls = 0;
  const response = await call(
    createManager(memory.store, apple.deviceCheck),
    async () => {
      providerCalls++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(providerResult) },
          },
        ],
      });
    },
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "onboarding_device_reply_used");
  assert.equal(providerCalls, 0);
  assert.equal(memory.record(), undefined);
});

test("an uninitialized DeviceCheck state permits one generation and then blocks the device", async () => {
  const firstStore = createStore();
  const apple = createDeviceCheck();
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  };

  const first = await call(
    createManager(firstStore.store, apple.deviceCheck),
    fetchImpl,
  );
  assert.equal(first.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(apple.marks(), 1);
  assert.equal(firstStore.claims(), 1);
  assert.equal(firstStore.attempts(), 1);

  const laterStore = createStore();
  const later = await call(
    createManager(laterStore.store, apple.deviceCheck),
    fetchImpl,
  );
  assert.equal(later.status, 409);
  assert.equal((await later.json()).code, "onboarding_device_reply_used");
  assert.equal(providerCalls, 1);
  assert.equal(laterStore.record(), undefined);
});

test("a DeviceCheck query failure remains fail-closed before Gemini", async () => {
  const memory = createStore();
  const apple = createDeviceCheck({
    queryError: new Error("Apple unavailable"),
  });
  let providerCalls = 0;

  const response = await call(
    createManager(memory.store, apple.deviceCheck),
    async (...args) => {
      providerCalls++;
      return provider(result)(...args);
    },
  );

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).code,
    "generation_protection_unavailable",
  );
  assert.equal(providerCalls, 0);
  assert.equal(memory.record(), undefined);
  assert.equal(apple.marks(), 0);
});

test("a new anonymous identity cannot bypass a DeviceCheck bit left by a deleted account", async () => {
  const replacementUserId = "00000000-0000-4000-8000-000000000002";
  const memory = createStore(replacementUserId);
  const apple = createDeviceCheck({ used: true });
  const manager = createManager(memory.store, apple.deviceCheck);

  await assert.rejects(
    () =>
      manager.prepare({
        deviceToken: DEVICE_TOKEN,
        trialId: TRIAL_ID,
        userId: replacementUserId,
      }),
    (failure: unknown) =>
      failure instanceof ConversationError &&
      failure.kind === "onboarding_device_reply_used",
  );
  assert.equal(memory.record(), undefined);
});

test("concurrent DeviceCheck trials dispatch one model request", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  const manager = createManager(memory.store, apple.deviceCheck);
  let providerCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    await gate;
    return provider(result)(...args);
  };

  const first = call(manager, fetchImpl);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await call(manager, fetchImpl);
  assert.equal(second.status, 429);
  assert.equal(providerCalls, 1);
  release();
  assert.equal((await first).status, 200);
});

// ---------------------------------------------------------------------------
// Onboarding requires DeviceCheck on ai-conversation-v2. There is no fallback to
// the account-scoped onboarding claim, and paid generations are unaffected.
// ---------------------------------------------------------------------------

const rawRequest = (body: unknown) =>
  new Request("http://localhost/ai-conversation-v2", {
    method: "POST",
    headers: { authorization: "Bearer signed-user" },
    body: JSON.stringify(body),
  });

function createSpies() {
  const calls = {
    claim: 0,
    claimOnboarding: 0,
    defer: 0,
    entitlement: 0,
    prepare: 0,
    provider: 0,
    release: 0,
  };
  const efforts: unknown[] = [];
  const lease = {
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    leaseId: "00000000-0000-4000-8000-000000000101",
  };
  const options = {
    entitlementVerifier: {
      verifyAccess: async () => {
        calls.entitlement++;
        return { hasActivePro: true, plan: "monthly" as const };
      },
    },
    getVerifiedUserId: async () => USER_ID,
    usageLimiter: {
      claim: async () => {
        calls.claim++;
        return lease;
      },
      claimOnboarding: async () => {
        calls.claimOnboarding++;
        return lease;
      },
      release: async () => {
        calls.release++;
        return true;
      },
    },
  };
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.provider++;
    efforts.push(JSON.parse(String(init?.body)).reasoning);
    return provider(result)(url as never, init);
  };
  // A manager that records use but never grants a trial, so any call is visible.
  const countingManager = {
    async prepare() {
      calls.prepare++;
      throw new ConversationError("generation_protection_unavailable");
    },
  };
  return { calls, countingManager, efforts, fetchImpl, options };
}
const untouched = {
  claim: 0,
  claimOnboarding: 0,
  defer: 0,
  entitlement: 0,
  prepare: 0,
  provider: 0,
  release: 0,
};

test("an onboarding request without a DeviceCheck token is rejected before any entitlement, usage claim or Gemini call", async () => {
  const spies = createSpies();
  const bodies = [
    { ...input, isOnboardingGeneration: true },
    { ...input, isOnboardingGeneration: true, onboardingTrialId: TRIAL_ID },
  ];
  for (const body of [...bodies, ...bodies]) {
    const response = await handleConversationRequest(rawRequest(body), "key", {
      ...spies.options,
      defer: () => spies.calls.defer++,
      fetchImpl: spies.fetchImpl,
      onboardingTrialManager: spies.countingManager,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
  // The account-scoped allowance is never consumed, however often it is retried.
  assert.deepEqual(spies.calls, untouched);
});

test("an empty, blank or malformed DeviceCheck token is rejected before any entitlement, usage claim or Gemini call", async () => {
  const spies = createSpies();
  for (const deviceCheckToken of [
    "",
    "   ",
    "not base64!!",
    "dGVz dA==",
    "====",
    "a".repeat(4097),
  ]) {
    const response = await handleConversationRequest(
      rawRequest({
        ...input,
        deviceCheckToken,
        isOnboardingGeneration: true,
        onboardingTrialId: TRIAL_ID,
      }),
      "key",
      {
        ...spies.options,
        fetchImpl: spies.fetchImpl,
        onboardingTrialManager: spies.countingManager,
      },
    );
    assert.equal(
      response.status,
      400,
      JSON.stringify(deviceCheckToken.slice(0, 12)),
    );
    assert.equal((await response.json()).code, "invalid_request");
  }
  assert.deepEqual(spies.calls, untouched);
});

test("a DeviceCheck token that Apple cannot verify fails closed before any entitlement, usage claim or Gemini call", async () => {
  const spies = createSpies();
  const memory = createStore();
  const apple = createDeviceCheck({
    queryError: new Error("Apple rejected the token"),
  });
  const response = await handleConversationRequest(deviceRequest(), "key", {
    ...spies.options,
    fetchImpl: spies.fetchImpl,
    onboardingTrialManager: createManager(memory.store, apple.deviceCheck),
  });

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).code,
    "generation_protection_unavailable",
  );
  assert.deepEqual(spies.calls, untouched);
  assert.equal(memory.record(), undefined);
  assert.equal(apple.marks(), 0);
});

test("a tokened onboarding request fails closed when DeviceCheck is not configured", async () => {
  const spies = createSpies();
  const response = await handleConversationRequest(deviceRequest(), "key", {
    ...spies.options,
    fetchImpl: spies.fetchImpl,
  });

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).code,
    "generation_protection_unavailable",
  );
  assert.deepEqual(spies.calls, untouched);
});

test("a valid onboarding request is authorized only by the DeviceCheck trial and runs at low reasoning", async () => {
  const spies = createSpies();
  const memory = createStore();
  const apple = createDeviceCheck();
  const manager = createManager(memory.store, apple.deviceCheck);
  const options = {
    ...spies.options,
    defer: () => spies.calls.defer++,
    fetchImpl: spies.fetchImpl,
    onboardingTrialManager: manager,
  };

  const first = await handleConversationRequest(
    deviceRequest(),
    "key",
    options,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), result);
  assert.deepEqual(spies.efforts, [{ effort: "low" }]);
  assert.equal(apple.marks(), 1);
  assert.equal(memory.claims(), 1);
  // No subscription lookup, no usage claim or lease, no deferred cleanup.
  assert.deepEqual(spies.calls, { ...untouched, provider: 1 });

  // The 15-minute cached replay still answers a retry without another model call.
  const replay = await handleConversationRequest(
    deviceRequest(),
    "key",
    options,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);
  assert.deepEqual(spies.calls, { ...untouched, provider: 1 });
});

test("a paid generation without a DeviceCheck token is unaffected and never touches the trial", async () => {
  for (const body of [input, { ...input, isOnboardingGeneration: false }]) {
    const spies = createSpies();
    const response = await handleConversationRequest(rawRequest(body), "key", {
      ...spies.options,
      fetchImpl: spies.fetchImpl,
      onboardingTrialManager: spies.countingManager,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), result);
    assert.deepEqual(spies.efforts, [{ effort: "low" }]);
    assert.deepEqual(spies.calls, {
      ...untouched,
      claim: 1,
      entitlement: 1,
      provider: 1,
      release: 1,
    });
  }
});

test("DeviceCheck fields cannot turn a paid request into an onboarding request or skip the entitlement check", async () => {
  const spies = createSpies();
  const response = await handleConversationRequest(
    rawRequest({
      ...input,
      deviceCheckToken: DEVICE_TOKEN,
      onboardingTrialId: TRIAL_ID,
    }),
    "key",
    {
      ...spies.options,
      fetchImpl: spies.fetchImpl,
      onboardingTrialManager: spies.countingManager,
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(spies.calls, untouched);
});

test("the exact onboarding request the shipped app builds is accepted and generated", async () => {
  // Mirrors lib/wingr-ai.ts: parseConversationRequest over screenshot, tone, the
  // (empty) trimmed context and the three onboarding fields, then JSON-encoded.
  const body = parseConversationRequest({
    screenshot: input.screenshot,
    selectedTone: "playful",
    extraContext: "",
    isOnboardingGeneration: true,
    deviceCheckToken: DEVICE_TOKEN,
    onboardingTrialId: TRIAL_ID,
  });
  const spies = createSpies();
  const memory = createStore();
  const apple = createDeviceCheck();
  const response = await handleConversationRequest(rawRequest(body), "key", {
    ...spies.options,
    fetchImpl: spies.fetchImpl,
    onboardingTrialManager: createManager(memory.store, apple.deviceCheck),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(spies.calls, { ...untouched, provider: 1 });
});
