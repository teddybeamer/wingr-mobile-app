import assert from "node:assert/strict";
import test from "node:test";
import { handleConversationRequest } from "./analyze-conversation.ts";
import { ConversationError, parseConversationRequest } from "./conversation.ts";
import {
  createDeviceCheckOnboardingTrialManager,
  createSupabaseOnboardingTrialStore,
} from "./onboarding-device-trial.ts";
import {
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
  hash: string;
  iv?: string;
  state: "generating" | "result_ready" | "finalized";
  userId: string;
};

// Models the database functions: one row per trial, bound to the hash it was
// begun with (a different hash for the same trial raises, as the SQL does), one
// active row per hash, and one account claim per user at finalize. The v2
// finalize records no ai_generation_attempts row, so `attempts` must stay 0.
// `claimedUsers` can be shared between stores to model one database.
function createStore(
  expectedUserId = USER_ID,
  claimedUsers = new Set<string>(),
) {
  let record: StoredTrial | undefined;
  let claims = 0;
  let attempts = 0;
  const hashes = new Set<string>();
  const unavailable = () =>
    new ConversationError("generation_protection_unavailable");
  const owned = (userId: string, trialId: string, hash: string) => {
    assert.equal(userId, expectedUserId);
    assert.equal(trialId, TRIAL_ID);
    if (record && record.hash !== hash) throw unavailable();
    return record;
  };
  const store: OnboardingTrialStore = {
    async abandon(userId, trialId, hash) {
      if (
        record?.userId === userId &&
        trialId === TRIAL_ID &&
        record.hash === hash &&
        record.state === "generating"
      )
        record = undefined;
    },
    async begin(userId, trialId, hash) {
      const existing = owned(userId, trialId, hash);
      hashes.add(hash);
      if (!existing) {
        if (claimedUsers.has(userId))
          return { status: "onboarding_reply_used" };
        record = { hash, state: "generating", userId };
        return { status: "started", retryAt: "2026-10-20T10:00:00.000Z" };
      }
      if (existing.state === "generating")
        return {
          status: "generation_in_progress",
          retryAt: "2026-10-20T10:00:00.000Z",
        };
      return {
        status: existing.state === "finalized" ? "replay" : "result_ready",
        ciphertext: existing.ciphertext,
        iv: existing.iv,
      };
    },
    async finalize(userId, trialId, hash) {
      const existing = owned(userId, trialId, hash);
      if (!existing || existing.state === "generating")
        return { status: "trial_unavailable" };
      if (existing.state === "finalized")
        return {
          status: "replay",
          ciphertext: existing.ciphertext,
          iv: existing.iv,
        };
      if (claimedUsers.has(userId)) return { status: "onboarding_reply_used" };
      claimedUsers.add(userId);
      claims++;
      // The free reply is never recorded as an attempt against a plan's allowance.
      existing.state = "finalized";
      return {
        status: "finalized",
        ciphertext: existing.ciphertext,
        iv: existing.iv,
      };
    },
    async saveResult(userId, trialId, hash, encrypted) {
      const existing = owned(userId, trialId, hash);
      if (!existing || existing.state !== "generating")
        return { status: "trial_unavailable" };
      record = { ...existing, ...encrypted, state: "result_ready" };
      return { status: "result_ready" };
    },
  };
  return {
    attempts: () => attempts,
    claims: () => claims,
    // Models the 60-second lease running out on a request that never finished.
    expireLease() {
      if (record?.state === "generating") record = undefined;
    },
    hashes: () => [...hashes],
    record: () => record,
    store,
  };
}

function createDeviceCheck({
  failMarks = 0,
  failQueriesAfter = Infinity,
  queryError,
  used: initialUsed = false,
}: {
  failMarks?: number;
  failQueriesAfter?: number;
  queryError?: Error;
  used?: boolean;
} = {}) {
  let marks = 0;
  let queries = 0;
  let used = initialUsed;
  return {
    deviceCheck: {
      async isOnboardingPreviewUsed() {
        queries++;
        if (queryError || queries > failQueriesAfter)
          throw queryError ?? new Error("Apple unavailable");
        return used;
      },
      async markOnboardingPreviewUsed() {
        marks++;
        if (marks <= failMarks) throw new Error("Apple unavailable");
        used = true;
      },
    },
    marks: () => marks,
    queries: () => queries,
  };
}

// DeviceCheck issues a new token for every request, so each call carries its own.
let tokenCounter = 0;
const freshToken = () => btoa(`device-token-${++tokenCounter}`);

function deviceRequest(deviceCheckToken = DEVICE_TOKEN) {
  return new Request("http://localhost/ai-conversation-v2", {
    method: "POST",
    headers: { authorization: "Bearer signed-user" },
    body: JSON.stringify({
      ...input,
      deviceCheckToken,
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
  { token = freshToken(), userId = USER_ID } = {},
) {
  return handleConversationRequest(deviceRequest(token), "key", {
    fetchImpl,
    getVerifiedUserId: async () => userId,
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
  assert.equal(memory.attempts(), 0);

  const replay = await call(manager, fetchImpl);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  assert.equal(memory.attempts(), 0);
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
  assert.equal(firstStore.attempts(), 0);

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
// One free successful reply per device: only a valid reply consumes it.
// ---------------------------------------------------------------------------

const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const unusable = (failureReason: string) => ({
  replyable: false,
  failureReason,
  vibeCheck: null,
  replies: [],
});
const sendAfter =
  (gate: Promise<void>, value: unknown): typeof fetch =>
  async (...args) => {
    await gate;
    return provider(value)(...args);
  };
const openGate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
};
// Lets every in-flight request run until it is waiting on a gate (hashing and
// storage each take a few event-loop turns).
const settleMicrotasks = async () => {
  for (let turn = 0; turn < 20; turn++)
    await new Promise((resolve) => setImmediate(resolve));
};

test("every kind of failure is free and the device keeps its one free reply for the next try", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  const manager = createManager(memory.store, apple.deviceCheck);
  const failures: [string, typeof fetch, number][] = [
    ["provider error", async () => new Response(null, { status: 503 }), 502],
    [
      "invalid JSON",
      async () =>
        Response.json({
          choices: [
            { finish_reason: "stop", message: { content: "{ not json" } },
          ],
        }),
      502,
    ],
    ["empty replies", provider({ ...result, replies: [] }), 502],
    ...[
      "unreadable_image",
      "no_conversation",
      "ownership_unclear",
      "no_replyable_message",
      "unknown",
    ].map((reason): [string, typeof fetch, number] => [
      reason,
      provider(unusable(reason)),
      422,
    ]),
  ];
  for (const [name, fetchImpl, status] of failures) {
    const response = await call(manager, fetchImpl);
    assert.equal(response.status, status, name);
    assert.equal(memory.record(), undefined, name);
    assert.equal(memory.claims(), 0, name);
    assert.equal(memory.attempts(), 0, name);
    assert.equal(apple.marks(), 0, name);
  }

  let providerCalls = 0;
  const success = await call(manager, async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  });
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), result);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  assert.equal(memory.attempts(), 0);
  assert.equal(apple.marks(), 1);

  // The one free reply is now used: a new device-state lookup blocks any more.
  const another = createStore();
  const blocked = await call(
    createManager(another.store, apple.deviceCheck),
    async () => {
      throw new Error("must not call the provider");
    },
  );
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "onboarding_device_reply_used");
});

test("a retry carries a new DeviceCheck token and still reaches the same trial", async () => {
  const memory = createStore();
  const apple = createDeviceCheck({ failMarks: 1 });
  const manager = createManager(memory.store, apple.deviceCheck);
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  };
  // Apple fails once after the reply is stored: the stored result is kept free.
  const first = await call(manager, fetchImpl, { token: freshToken() });
  assert.equal(first.status, 503);
  assert.equal(memory.claims(), 0);
  const second = await call(manager, fetchImpl, { token: freshToken() });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), result);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  // Every call used the same stored binding although every token differed.
  assert.equal(memory.hashes().length, 1);
});

test("the stored binding is derived from the trial ID, never from the DeviceCheck token", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  const tokens = [freshToken(), freshToken()];
  await call(createManager(memory.store, apple.deviceCheck), provider(result), {
    token: tokens[0],
  });
  await call(createManager(memory.store, apple.deviceCheck), provider(result), {
    token: tokens[1],
  });
  assert.deepEqual(memory.hashes(), [await sha256Hex(TRIAL_ID)]);
  for (const token of tokens)
    assert.notEqual(memory.hashes()[0], await sha256Hex(token));
});

test("an interrupted request blocks a retry only until its lease ends, then the retry succeeds", async () => {
  const memory = createStore();
  const apple = createDeviceCheck();
  const manager = createManager(memory.store, apple.deviceCheck);
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (...args) => {
    providerCalls++;
    return provider(result)(...args);
  };
  // The first request dies after taking the trial: nothing abandons it.
  await manager.prepare({
    deviceToken: freshToken(),
    trialId: TRIAL_ID,
    userId: USER_ID,
  });
  assert.equal(memory.record()?.state, "generating");

  const during = await call(manager, fetchImpl);
  assert.equal(during.status, 429);
  const body = await during.json();
  assert.equal(body.code, "generation_in_progress");
  assert.equal(providerCalls, 0);

  memory.expireLease();
  const after = await call(manager, fetchImpl);
  assert.equal(after.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(memory.claims(), 1);
  assert.equal(apple.marks(), 1);
});

test("parallel requests with different tokens produce one reply, one model call and one claim", async () => {
  for (const count of [2, 10, 50]) {
    const memory = createStore();
    const apple = createDeviceCheck();
    const manager = createManager(memory.store, apple.deviceCheck);
    const gate = openGate();
    let providerCalls = 0;
    const fetchImpl: typeof fetch = async (...args) => {
      providerCalls++;
      return sendAfter(gate.promise, result)(...args);
    };
    const pending = Promise.all(
      Array.from({ length: count }, () => call(manager, fetchImpl)),
    );
    await settleMicrotasks();
    assert.equal(providerCalls, 1, `${count}`);
    gate.open();
    const responses = await pending;
    assert.equal(responses.filter(({ status }) => status === 200).length, 1);
    const rejected = responses.filter(({ status }) => status === 429);
    assert.equal(rejected.length, count - 1);
    for (const response of rejected)
      assert.equal((await response.json()).code, "generation_in_progress");
    assert.equal(memory.claims(), 1);
    assert.equal(memory.attempts(), 0);
    assert.equal(apple.marks(), 1);
  }
});

test("a request that finishes after another account released the device's reply returns nothing", async () => {
  const claimedUsers = new Set<string>();
  const otherUserId = "00000000-0000-4000-8000-000000000002";
  const first = createStore(USER_ID, claimedUsers);
  const second = createStore(otherUserId, claimedUsers);
  // One physical device: both accounts see the same DeviceCheck state.
  const apple = createDeviceCheck();
  const firstGate = openGate();
  const secondGate = openGate();
  const slow = call(
    createManager(second.store, apple.deviceCheck),
    sendAfter(secondGate.promise, result),
    { userId: otherUserId },
  );
  const fast = call(
    createManager(first.store, apple.deviceCheck),
    sendAfter(firstGate.promise, result),
  );
  await settleMicrotasks();
  // Both passed the first DeviceCheck lookup and are generating.
  assert.equal(first.record()?.state, "generating");
  assert.equal(second.record()?.state, "generating");

  firstGate.open();
  assert.equal((await fast).status, 200);
  secondGate.open();
  const late = await slow;
  assert.equal(late.status, 409);
  assert.equal((await late.json()).code, "onboarding_device_reply_used");
  // The late request is released without a claim, mark or stored result.
  assert.equal(second.record(), undefined);
  assert.equal(second.claims(), 0);
  assert.equal(first.claims(), 1);
  assert.equal(apple.marks(), 1);
});

test("a DeviceCheck failure just before storing the reply is free and the next try succeeds", async () => {
  const memory = createStore();
  const flaky = createDeviceCheck({ failQueriesAfter: 1 });
  const failed = await call(
    createManager(memory.store, flaky.deviceCheck),
    provider(result),
  );
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).code, "generation_protection_unavailable");
  assert.equal(flaky.queries(), 2);
  assert.equal(memory.record(), undefined);
  assert.equal(memory.claims(), 0);
  assert.equal(flaky.marks(), 0);

  const apple = createDeviceCheck();
  const retry = await call(
    createManager(memory.store, apple.deviceCheck),
    provider(result),
  );
  assert.equal(retry.status, 200);
  assert.equal(memory.claims(), 1);
});

test("the free reply is never recorded against a plan allowance, on success or replay", async () => {
  const memory = createStore();
  const apple = createDeviceCheck({ failMarks: 1 });
  const manager = createManager(memory.store, apple.deviceCheck);
  for (const expected of [503, 200, 200])
    assert.equal((await call(manager, provider(result))).status, expected);
  assert.equal(memory.claims(), 1);
  assert.equal(memory.attempts(), 0);
});

test("the v2 store finalizes through the function that records no attempt and leaves the rest alone", async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const store = createSupabaseOnboardingTrialStore({
    supabaseUrl: "https://wingr.supabase.co/",
    serviceRoleKey: "service-role",
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      bodies.push(JSON.parse(String(init?.body)));
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer service-role",
      );
      return Response.json({ status: "finalized" });
    },
  });
  const hash = "a".repeat(64);
  await store.begin(USER_ID, TRIAL_ID, hash);
  await store.saveResult(USER_ID, TRIAL_ID, hash, { ciphertext: "c", iv: "i" });
  assert.deepEqual(await store.finalize(USER_ID, TRIAL_ID, hash), {
    status: "finalized",
  });
  await store.abandon(USER_ID, TRIAL_ID, hash);
  const base = "https://wingr.supabase.co/rest/v1/rpc/";
  assert.deepEqual(urls, [
    `${base}begin_onboarding_device_trial`,
    `${base}store_onboarding_device_trial_result`,
    `${base}finalize_onboarding_device_trial_v2`,
    `${base}abandon_onboarding_device_trial`,
  ]);
  assert.deepEqual(bodies[2], {
    requested_user_id: USER_ID,
    onboarding_trial_id: TRIAL_ID,
    requested_device_token_hash: hash,
  });
});

test("the v2 store fails closed when finalizing errors or returns something unreadable", async () => {
  for (const respond of [
    async () => new Response("no", { status: 500 }),
    async () => new Response("not json"),
    async () => {
      throw new TypeError("network");
    },
  ]) {
    const store = createSupabaseOnboardingTrialStore({
      supabaseUrl: "https://wingr.supabase.co",
      serviceRoleKey: "service-role",
      fetchImpl: respond,
    });
    await assert.rejects(
      store.finalize(USER_ID, TRIAL_ID, "a".repeat(64)),
      (failure: unknown) =>
        failure instanceof ConversationError &&
        failure.kind === "generation_protection_unavailable",
    );
  }
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
    entitlement: 0,
    prepare: 0,
    provider: 0,
    reserve: 0,
    settle: 0,
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
      reserve: async () => {
        calls.reserve++;
        return lease;
      },
      settle: async () => {
        calls.settle++;
        return { applied: true, charged: true };
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
  entitlement: 0,
  prepare: 0,
  provider: 0,
  reserve: 0,
  settle: 0,
};

test("an onboarding request without a DeviceCheck token is rejected before any entitlement, usage reservation or Gemini call", async () => {
  const spies = createSpies();
  const bodies = [
    { ...input, isOnboardingGeneration: true },
    { ...input, isOnboardingGeneration: true, onboardingTrialId: TRIAL_ID },
  ];
  for (const body of [...bodies, ...bodies]) {
    const response = await handleConversationRequest(rawRequest(body), "key", {
      ...spies.options,
      fetchImpl: spies.fetchImpl,
      onboardingTrialManager: spies.countingManager,
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  }
  // The account-scoped allowance is never consumed, however often it is retried.
  assert.deepEqual(spies.calls, untouched);
});

test("an empty, blank or malformed DeviceCheck token is rejected before any entitlement, usage reservation or Gemini call", async () => {
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

test("a DeviceCheck token that Apple cannot verify fails closed before any entitlement, usage reservation or Gemini call", async () => {
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
  // No subscription lookup, no usage reservation or lease, nothing to settle.
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
      entitlement: 1,
      provider: 1,
      reserve: 1,
      settle: 1,
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
