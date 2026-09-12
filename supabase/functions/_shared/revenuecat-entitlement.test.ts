import assert from "node:assert/strict";
import test from "node:test";
import {
  createRevenueCatEntitlementVerifier,
  RevenueCatVerificationError,
} from "./revenuecat-entitlement.ts";

const APP_USER_ID = "00000000-0000-4000-8000-000000000001";
const PRO_ENTITLEMENT_RESOURCE_ID = "entl_pro";

function response(items: unknown[], nextPage: string | null = null) {
  return Response.json({
    object: "list",
    items,
    next_page: nextPage,
    url: `/v2/projects/proj_wingr/customers/${APP_USER_ID}/active_entitlements`,
  });
}

function missingCustomerResponse() {
  return Response.json(
    { type: "resource_missing", message: "PRIVATE UPSTREAM RESPONSE" },
    { status: 404 },
  );
}

function customerListResponse(value: Record<string, unknown> = {}) {
  return Response.json({
    object: "list",
    items: [],
    next_page: null,
    url: "/v2/projects/proj_wingr/customers",
    ...value,
  });
}

function activeEntitlement(entitlementId: string) {
  return {
    object: "customer.active_entitlement",
    entitlement_id: entitlementId,
    expires_at: Date.now() + 60_000,
  };
}

function verifier(fetchImpl: typeof fetch, timeoutMs = 5_000) {
  return createRevenueCatEntitlementVerifier({
    apiKey: "server-secret",
    fetchImpl,
    proEntitlementResourceId: PRO_ENTITLEMENT_RESOURCE_ID,
    projectId: "proj_wingr",
    timeoutMs,
  });
}

test("active pro is read from RevenueCat v2 using only the authenticated App User ID", async () => {
  let calls = 0;
  const hasPro = await verifier(async (url, init) => {
    calls++;
    assert.equal(
      String(url),
      `https://api.revenuecat.com/v2/projects/proj_wingr/customers/${APP_USER_ID}/active_entitlements?limit=100`,
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer server-secret");
    assert.equal(headers.get("accept"), "application/json");
    assert.ok(init?.signal);
    return response([activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)]);
  }).hasActivePro(APP_USER_ID);
  assert.equal(hasPro, true);
  assert.equal(calls, 1);
});

test("a successful RevenueCat response without pro denies access", async () => {
  for (const items of [[], [activeEntitlement("entl_other")]]) {
    const hasPro = await verifier(async () => response(items)).hasActivePro(
      APP_USER_ID,
    );
    assert.equal(hasPro, false);
  }
});

test("a confirmed missing RevenueCat customer has no active pro entitlement", async () => {
  const urls: string[] = [];
  const hasPro = await verifier(async (url, init) => {
    urls.push(String(url));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer server-secret");
    return urls.length === 1 ? missingCustomerResponse() : customerListResponse();
  }).hasActivePro(APP_USER_ID);
  assert.equal(hasPro, false);
  assert.deepEqual(urls, [
    `https://api.revenuecat.com/v2/projects/proj_wingr/customers/${APP_USER_ID}/active_entitlements?limit=100`,
    "https://api.revenuecat.com/v2/projects/proj_wingr/customers?limit=1",
  ]);
});

test("only resource_missing 404 triggers the project confirmation", async () => {
  let calls = 0;
  await assert.rejects(
    verifier(async () => {
      calls++;
      return Response.json({ type: "different_error" }, { status: 404 });
    }).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.upstreamStatus, 404);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("missing-customer confirmation failures remain fail closed", async () => {
  for (const status of [404, 401, 403, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(
      verifier(async () => {
        calls++;
        return calls === 1
          ? missingCustomerResponse()
          : Response.json({ type: "confirmation_failure" }, { status });
      }).hasActivePro(APP_USER_ID),
      (failure: unknown) => {
        assert.ok(failure instanceof RevenueCatVerificationError);
        assert.equal(failure.reason, "unavailable");
        assert.equal(failure.upstreamStatus, status);
        return true;
      },
    );
    assert.equal(calls, 2);
  }
});

test("a malformed missing-customer confirmation response remains fail closed", async () => {
  let calls = 0;
  await assert.rejects(
    verifier(async () => {
      calls++;
      return calls === 1
        ? missingCustomerResponse()
        : customerListResponse({ url: undefined });
    }).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.reason, "malformed");
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("RevenueCat 401, 403, and 429 responses fail closed", async () => {
  for (const status of [401, 403, 429]) {
    await assert.rejects(
      verifier(async () =>
        Response.json(
          { type: "PRIVATE", message: "PRIVATE UPSTREAM RESPONSE" },
          { status },
        ),
      ).hasActivePro(APP_USER_ID),
      (failure: unknown) => {
        assert.ok(failure instanceof RevenueCatVerificationError);
        assert.equal(failure.reason, "unavailable");
        assert.equal(failure.upstreamStatus, status);
        assert.ok(!failure.message.includes("PRIVATE"));
        return true;
      },
    );
  }
});

test("RevenueCat failure metadata retains only machine-readable type and code", async () => {
  await assert.rejects(
    verifier(async () =>
      Response.json(
        {
          type: "resource_missing",
          code: "customer_not_found",
          message: "PRIVATE UPSTREAM RESPONSE",
        },
        { status: 404 },
      ),
    ).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.reason, "unavailable");
      assert.equal(failure.upstreamStatus, 404);
      assert.equal(failure.upstreamErrorType, "resource_missing");
      assert.equal(failure.upstreamErrorCode, "customer_not_found");
      assert.ok(!failure.message.includes("PRIVATE"));
      return true;
    },
  );
});

test("network failures and timeouts fail closed", async () => {
  await assert.rejects(
    verifier(async () => {
      throw new Error("PRIVATE NETWORK FAILURE");
    }).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.reason, "unavailable");
      assert.ok(!failure.message.includes("PRIVATE"));
      return true;
    },
  );

  await assert.rejects(
    verifier(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      5,
    ).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.reason, "timeout");
      return true;
    },
  );
});

test("malformed and incomplete RevenueCat responses fail closed", async () => {
  for (const payload of [
    null,
    {},
    { object: "list", items: "not-an-array", next_page: null, url: "/" },
    {
      object: "list",
      items: [{ entitlement_id: PRO_ENTITLEMENT_RESOURCE_ID }],
      next_page: null,
      url: "/",
    },
    {
      object: "list",
      items: [activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)],
      next_page: 1,
      url: "/",
    },
  ]) {
    await assert.rejects(
      verifier(async () => Response.json(payload)).hasActivePro(APP_USER_ID),
      (failure: unknown) => {
        assert.ok(failure instanceof RevenueCatVerificationError);
        assert.equal(failure.reason, "malformed");
        return true;
      },
    );
  }

  await assert.rejects(
    verifier(async () => new Response("not-json")).hasActivePro(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.reason, "malformed");
      return true;
    },
  );
});

test("pagination must be complete before confirming pro is inactive", async () => {
  const urls: string[] = [];
  const hasPro = await verifier(async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? response(
          [activeEntitlement("entl_other")],
          "/v2/projects/proj_wingr/customers/user/active_entitlements?starting_after=entl_other",
        )
      : response([activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)]);
  }).hasActivePro(APP_USER_ID);
  assert.equal(hasPro, true);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /starting_after=entl_other/);
});
