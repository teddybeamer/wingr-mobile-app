import assert from "node:assert/strict";
import test from "node:test";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { ConversationError } from "./conversation.ts";
import {
  createDeviceCheckOnboardingTrialManager,
  createTrialCipher,
  type OnboardingTrialStore,
} from "./onboarding-device-trial.ts";
import { input, result } from "./test-fixtures.ts";

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
      if (record?.userId === userId && trialId === TRIAL_ID && record.state === "generating")
        record = undefined;
    },
    async begin(userId, trialId) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record) {
        record = { state: "generating", userId };
        return { status: "started" };
      }
      if (record.state === "generating") return { status: "generation_in_progress" };
      return {
        status: record.state === "finalized" ? "replay" : "result_ready",
        ciphertext: record.ciphertext,
        iv: record.iv,
      };
    },
    async finalize(userId, trialId) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record || record.state === "generating") return { status: "trial_unavailable" };
      if (record.state === "finalized")
        return { status: "replay", ciphertext: record.ciphertext, iv: record.iv };
      claims++;
      attempts++;
      record.state = "finalized";
      return { status: "finalized", ciphertext: record.ciphertext, iv: record.iv };
    },
    async saveResult(userId, trialId, _hash, encrypted) {
      assert.equal(userId, expectedUserId);
      assert.equal(trialId, TRIAL_ID);
      if (!record || record.state !== "generating") return { status: "trial_unavailable" };
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

function createDeviceCheck({ failMarks = 0, used = false } = {}) {
  let marks = 0;
  return {
    deviceCheck: {
      async isOnboardingPreviewUsed() {
        return used;
      },
      async markOnboardingPreviewUsed() {
        marks++;
        if (marks <= failMarks) throw new Error("Apple unavailable");
      },
    },
    marks: () => marks,
  };
}

function deviceRequest() {
  return new Request("http://localhost/ai-conversation", {
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

const provider = (value: unknown): typeof fetch => async () =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
  });

function createManager(store: OnboardingTrialStore, deviceCheck: ReturnType<typeof createDeviceCheck>["deviceCheck"]) {
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
  const response = await call(createManager(memory.store, apple.deviceCheck), async () => {
    providerCalls++;
    throw new Error("network unavailable");
  });

  assert.equal(response.status, 502);
  assert.equal(providerCalls, 1);
  assert.equal(memory.record(), undefined);
  assert.equal(memory.claims(), 0);
  assert.equal(memory.attempts(), 0);
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
          { finish_reason: "stop", message: { content: JSON.stringify(result) } },
        ],
      });
    },
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "onboarding_device_reply_used");
  assert.equal(providerCalls, 0);
  assert.equal(memory.record(), undefined);
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
