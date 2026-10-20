import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "./conversation.ts";
import {
  createSupabaseUsageLimiter,
  SETTLEMENT_TIMEOUT_MS,
} from "./usage-limit.ts";

const LEASE_ID = "00000000-0000-4000-8000-000000000101";
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
const limiterWith = (fetchImpl: typeof fetch) =>
  createSupabaseUsageLimiter({
    supabaseUrl: "https://wingr.supabase.co",
    publishableKey: "publishable-key",
    fetchImpl,
  });
const failsClosed = (error: unknown) =>
  error instanceof ConversationError &&
  error.kind === "generation_protection_unavailable";

test("reserve and settle call the v2 functions with the caller JWT", async () => {
  const calls: { body: unknown; url: unknown }[] = [];
  const expiration = expiresAt();
  const limiter = limiterWith(async (url, init) => {
    calls.push({ body: init?.body, url });
    assert.deepEqual(
      new Headers(init?.headers),
      new Headers({
        apikey: "publishable-key",
        authorization: "Bearer user-token",
        "content-type": "application/json",
      }),
    );
    return calls.length === 1
      ? Response.json({
          status: "allowed",
          retryAt: null,
          leaseId: LEASE_ID,
          expiresAt: expiration,
        })
      : Response.json({ status: "settled", charged: true });
  });
  const lease = await limiter.reserve("Bearer user-token", "weekly");
  assert.deepEqual(lease, { expiresAt: expiration, leaseId: LEASE_ID });
  assert.deepEqual(
    await limiter.settle("Bearer user-token", lease.leaseId, "success"),
    { applied: true, charged: true },
  );
  assert.deepEqual(calls, [
    {
      body: '{"subscription_plan":"weekly"}',
      url: "https://wingr.supabase.co/rest/v1/rpc/reserve_ai_generation",
    },
    {
      body: `{"requested_lease_id":"${LEASE_ID}","outcome":"success"}`,
      url: "https://wingr.supabase.co/rest/v1/rpc/settle_ai_generation",
    },
  ]);
});

test("reserve exposes a typed limit error and an active lease as retryable", async () => {
  const expiration = expiresAt();
  for (const [status, retryAt] of [
    ["usage_limit", "2026-10-09T14:34:00+00:00"],
    ["generation_in_progress", expiration],
  ] as const) {
    const limiter = limiterWith(async () => Response.json({ status, retryAt }));
    await assert.rejects(
      limiter.reserve("Bearer user-token", "monthly"),
      (error: unknown) =>
        error instanceof ConversationError &&
        error.kind === status &&
        error.retryAt === new Date(retryAt).toISOString(),
    );
  }
});

test("reserve fails closed on a missing token, a bad plan or a malformed response", async () => {
  let calls = 0;
  const limiter = limiterWith(async () => {
    calls++;
    return Response.json({ status: "allowed", leaseId: "not-a-uuid" });
  });
  await assert.rejects(limiter.reserve(null, "weekly"), failsClosed);
  await assert.rejects(limiter.reserve("Basic abc", "weekly"), failsClosed);
  await assert.rejects(
    limiter.reserve("Bearer user-token", "yearly" as never),
    failsClosed,
  );
  assert.equal(calls, 0);
  for (const body of [
    { status: "allowed", leaseId: LEASE_ID },
    { status: "allowed", leaseId: "not-a-uuid", expiresAt: expiresAt() },
    { status: "other" },
    null,
  ])
    await assert.rejects(
      limiterWith(async () => Response.json(body)).reserve(
        "Bearer user-token",
        "weekly",
      ),
      failsClosed,
    );
  await assert.rejects(
    limiterWith(async () => new Response("no", { status: 500 })).reserve(
      "Bearer user-token",
      "weekly",
    ),
    failsClosed,
  );
  await assert.rejects(
    limiterWith(async () => {
      throw new TypeError("network");
    }).reserve("Bearer user-token", "weekly"),
    failsClosed,
  );
});

test("settle reports every outcome and whether the lease was still held", async () => {
  for (const [response, expected] of [
    [
      { status: "settled", charged: true },
      { applied: true, charged: true },
    ],
    [
      { status: "settled", charged: false },
      { applied: true, charged: false },
    ],
    [
      { status: "not_found", charged: false },
      { applied: false, charged: false },
    ],
  ] as const)
    for (const outcome of [
      "success",
      "invalid_screenshot",
      "failure",
    ] as const) {
      const bodies: unknown[] = [];
      const limiter = limiterWith(async (_url, init) => {
        bodies.push(init?.body);
        return Response.json(response);
      });
      assert.deepEqual(
        await limiter.settle("Bearer user-token", LEASE_ID, outcome),
        expected,
      );
      assert.deepEqual(bodies, [
        JSON.stringify({ requested_lease_id: LEASE_ID, outcome }),
      ]);
    }
});

test("settle fails closed without calling the database for invalid input", async () => {
  let calls = 0;
  const limiter = limiterWith(async () => {
    calls++;
    return Response.json({ status: "settled", charged: true });
  });
  await assert.rejects(limiter.settle(null, LEASE_ID, "success"), failsClosed);
  await assert.rejects(
    limiter.settle("Bearer user-token", "not-a-uuid", "success"),
    failsClosed,
  );
  await assert.rejects(
    limiter.settle("Bearer user-token", LEASE_ID, "refund" as never),
    failsClosed,
  );
  assert.equal(calls, 0);
});

test("settle never retries: an error response or malformed result is one failed call", async () => {
  for (const respond of [
    async () => new Response("down", { status: 503 }),
    async () => Response.json({ status: "settled" }),
    async () => Response.json({ status: "maybe", charged: true }),
    async () => Response.json({ status: "settled", charged: "yes" }),
    async () => {
      throw new TypeError("network");
    },
  ]) {
    let calls = 0;
    const limiter = limiterWith(async () => {
      calls++;
      return respond();
    });
    await assert.rejects(
      limiter.settle("Bearer user-token", LEASE_ID, "success"),
      failsClosed,
    );
    assert.equal(calls, 1);
  }
});

test("settle is bounded by a timeout and aborts the request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let aborted = false;
  const limiter = limiterWith(
    async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  );
  const pending = assert.rejects(
    limiter.settle("Bearer user-token", LEASE_ID, "success"),
    failsClosed,
  );
  t.mock.timers.tick(SETTLEMENT_TIMEOUT_MS);
  await pending;
  assert.equal(aborted, true);
});

// A fake of the two database functions that honours the same contract, so the
// limiter can be exercised across separate instances (separate sessions).
function createFakeDatabase() {
  const leases = new Map<string, string>();
  let attempts = 0;
  let pending = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    await Promise.resolve();
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("reserve_ai_generation")) {
      if (leases.has("user"))
        return Response.json({
          status: "generation_in_progress",
          retryAt: expiresAt(),
        });
      const leaseId = crypto.randomUUID();
      leases.set("user", leaseId);
      return Response.json({
        status: "allowed",
        retryAt: null,
        leaseId,
        expiresAt: expiresAt(),
      });
    }
    if (leases.get("user") !== body.requested_lease_id)
      return Response.json({ status: "not_found", charged: false });
    leases.delete("user");
    let charged = body.outcome === "success";
    if (body.outcome === "invalid_screenshot") {
      pending++;
      if (pending === 5) {
        pending = 0;
        charged = true;
      }
    }
    if (charged) attempts++;
    return Response.json({ status: "settled", charged });
  };
  return { attempts: () => attempts, fetchImpl, pending: () => pending };
}

test("50 parallel reservations yield one lease and one settlement yields one charge", async () => {
  const database = createFakeDatabase();
  const limiter = limiterWith(database.fetchImpl);
  const reservations = await Promise.allSettled(
    Array.from({ length: 50 }, () =>
      limiter.reserve("Bearer user-token", "monthly"),
    ),
  );
  const leases = reservations.filter(({ status }) => status === "fulfilled");
  assert.equal(leases.length, 1);
  assert.equal(database.attempts(), 0);
  const { leaseId } = (leases[0] as PromiseFulfilledResult<{ leaseId: string }>)
    .value;

  const settlements = await Promise.all(
    Array.from({ length: 30 }, () =>
      limiter.settle("Bearer user-token", leaseId, "success"),
    ),
  );
  assert.equal(settlements.filter(({ applied }) => applied).length, 1);
  assert.equal(settlements.filter(({ charged }) => charged).length, 1);
  assert.equal(database.attempts(), 1);
});

test("the invalid screenshot count persists across limiter instances", async () => {
  const database = createFakeDatabase();
  const charges: boolean[] = [];
  for (let index = 0; index < 10; index++) {
    // A fresh limiter per request stands in for a fresh session or cold start.
    const limiter = limiterWith(database.fetchImpl);
    const lease = await limiter.reserve("Bearer user-token", "weekly");
    const settled = await limiter.settle(
      "Bearer user-token",
      lease.leaseId,
      "invalid_screenshot",
    );
    charges.push(settled.charged);
  }
  assert.deepEqual(charges, [
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    true,
  ]);
  assert.equal(database.attempts(), 2);
  assert.equal(database.pending(), 0);
});
