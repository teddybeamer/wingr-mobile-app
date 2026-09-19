import assert from "node:assert/strict";
import test from "node:test";
import {
  createRevenueCatEntitlementVerifier,
  RevenueCatVerificationError,
} from "./revenuecat-entitlement.ts";

const APP_USER_ID = "00000000-0000-4000-8000-000000000001";
const PRO_ENTITLEMENT_RESOURCE_ID = "entl_pro";
const WEEKLY_PRODUCT_RESOURCE_ID = "prodcf6bb9dcdc";
const MONTHLY_PRODUCT_RESOURCE_ID = "prodeb09795a02";
const CUSTOMER_PATH = `/v2/projects/proj_wingr/customers/${APP_USER_ID}`;

function listResponse(
  url: string,
  items: unknown[],
  nextPage: string | null = null,
) {
  return Response.json({ object: "list", items, next_page: nextPage, url });
}

function entitlementResponse(items: unknown[], nextPage: string | null = null) {
  return listResponse(`${CUSTOMER_PATH}/active_entitlements`, items, nextPage);
}

function subscriptionResponse(
  items: unknown[],
  nextPage: string | null = null,
) {
  return listResponse(`${CUSTOMER_PATH}/subscriptions`, items, nextPage);
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

function subscription(
  id: string,
  productId: string | null,
  {
    entitlementIds = [PRO_ENTITLEMENT_RESOURCE_ID],
    givesAccess = true,
    pendingProductId,
  }: {
    entitlementIds?: string[];
    givesAccess?: boolean;
    pendingProductId?: string;
  } = {},
) {
  return {
    object: "subscription",
    id,
    product_id: productId,
    gives_access: givesAccess,
    entitlements: {
      object: "list",
      items: entitlementIds.map((entitlementId) => ({
        object: "entitlement",
        id: entitlementId,
      })),
      next_page: null,
      url: `/v2/projects/proj_wingr/subscriptions/${id}/entitlements`,
    },
    ...(pendingProductId
      ? { pending_changes: { product: { id: pendingProductId } } }
      : {}),
  };
}

function verifier(fetchImpl: typeof fetch, timeoutMs = 5_000) {
  return createRevenueCatEntitlementVerifier({
    apiKey: "server-secret",
    fetchImpl,
    monthlyProductResourceId: MONTHLY_PRODUCT_RESOURCE_ID,
    proEntitlementResourceId: PRO_ENTITLEMENT_RESOURCE_ID,
    projectId: "proj_wingr",
    timeoutMs,
    weeklyProductResourceId: WEEKLY_PRODUCT_RESOURCE_ID,
  });
}

function accessFetch(subscriptions: unknown[]): typeof fetch {
  return async (url) =>
    String(url).includes("/active_entitlements")
      ? entitlementResponse([activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)])
      : subscriptionResponse(subscriptions);
}

test("active pro plan comes from trusted RevenueCat subscription product IDs", async () => {
  for (const [productId, plan] of [
    [WEEKLY_PRODUCT_RESOURCE_ID, "weekly"],
    [MONTHLY_PRODUCT_RESOURCE_ID, "monthly"],
  ] as const) {
    const urls: string[] = [];
    const access = await verifier(async (url, init) => {
      urls.push(String(url));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer server-secret");
      assert.equal(headers.get("accept"), "application/json");
      assert.ok(init?.signal);
      return String(url).includes("/active_entitlements")
        ? entitlementResponse([activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)])
        : subscriptionResponse([subscription(`sub_${plan}`, productId)]);
    }).verifyAccess(APP_USER_ID);

    assert.deepEqual(access, { hasActivePro: true, plan });
    assert.deepEqual(urls, [
      `https://api.revenuecat.com/v2/projects/proj_wingr/customers/${APP_USER_ID}/active_entitlements?limit=100`,
      `https://api.revenuecat.com/v2/projects/proj_wingr/customers/${APP_USER_ID}/subscriptions?limit=100`,
    ]);
  }
});

test("RevenueCat list responses may omit next_page when pagination is complete", async () => {
  const access = await verifier(async (url) =>
    Response.json({
      object: "list",
      items: String(url).includes("/active_entitlements")
        ? [activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID)]
        : [subscription("sub_weekly", WEEKLY_PRODUCT_RESOURCE_ID)],
      url: String(url).includes("/active_entitlements")
        ? `${CUSTOMER_PATH}/active_entitlements`
        : `${CUSTOMER_PATH}/subscriptions`,
    }),
  ).verifyAccess(APP_USER_ID);

  assert.deepEqual(access, { hasActivePro: true, plan: "weekly" });
});

test("a successful RevenueCat response without pro denies access without reading subscriptions", async () => {
  for (const items of [[], [activeEntitlement("entl_other")]]) {
    let calls = 0;
    const access = await verifier(async () => {
      calls++;
      return entitlementResponse(items);
    }).verifyAccess(APP_USER_ID);
    assert.deepEqual(access, { hasActivePro: false });
    assert.equal(calls, 1);
  }
});

test("a confirmed missing RevenueCat customer has no active pro entitlement", async () => {
  const urls: string[] = [];
  const access = await verifier(async (url, init) => {
    urls.push(String(url));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer server-secret");
    return urls.length === 1
      ? missingCustomerResponse()
      : customerListResponse();
  }).verifyAccess(APP_USER_ID);
  assert.deepEqual(access, { hasActivePro: false });
  assert.deepEqual(urls, [
    `https://api.revenuecat.com/v2/projects/proj_wingr/customers/${APP_USER_ID}/active_entitlements?limit=100`,
    "https://api.revenuecat.com/v2/projects/proj_wingr/customers?limit=1",
  ]);
});

test("only resource_missing 404 triggers the missing-customer confirmation", async () => {
  let calls = 0;
  await assert.rejects(
    verifier(async () => {
      calls++;
      return Response.json({ type: "different_error" }, { status: 404 });
    }).verifyAccess(APP_USER_ID),
    (failure: unknown) => {
      assert.ok(failure instanceof RevenueCatVerificationError);
      assert.equal(failure.upstreamStatus, 404);
      assert.equal(failure.operation, "active_entitlements");
      assert.equal(failure.category, "resource_not_found");
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
      }).verifyAccess(APP_USER_ID),
      (failure: unknown) => {
        assert.ok(failure instanceof RevenueCatVerificationError);
        assert.equal(failure.reason, "unavailable");
        assert.equal(failure.upstreamStatus, status);
        assert.equal(failure.operation, "customer_list_confirmation");
        assert.equal(
          failure.category,
          status === 401
            ? "authentication"
            : status === 403
              ? "permissions"
              : status === 404
                ? "project_mismatch"
                : "upstream_response",
        );
        return true;
      },
    );
    assert.equal(calls, 2);
  }
});

test("subscription permission and upstream failures fail closed", async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(
      verifier(async (url) =>
        String(url).includes("/active_entitlements")
          ? entitlementResponse([
              activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID),
            ])
          : Response.json(
              { type: "PRIVATE", message: "PRIVATE UPSTREAM RESPONSE" },
              { status },
            ),
      ).verifyAccess(APP_USER_ID),
      (failure: unknown) => {
        assert.ok(failure instanceof RevenueCatVerificationError);
        assert.equal(failure.reason, "unavailable");
        assert.equal(failure.upstreamStatus, status);
        assert.equal(failure.operation, "subscriptions");
        assert.equal(
          failure.category,
          status === 401
            ? "authentication"
            : status === 403
              ? "permissions"
              : "upstream_response",
        );
        assert.ok(!failure.message.includes("PRIVATE"));
        return true;
      },
    );
  }
});

test("plan classification fails closed for unknown, promotional, or missing active pro subscriptions", async () => {
  for (const subscriptions of [
    [subscription("sub_unknown", "prod_unknown")],
    [subscription("sub_promotional", null)],
    [
      subscription("sub_expired", WEEKLY_PRODUCT_RESOURCE_ID, {
        givesAccess: false,
      }),
    ],
    [
      subscription("sub_other", WEEKLY_PRODUCT_RESOURCE_ID, {
        entitlementIds: ["entl_other"],
      }),
    ],
    [],
  ]) {
    await assert.rejects(
      verifier(accessFetch(subscriptions)).verifyAccess(APP_USER_ID),
      (failure: unknown) =>
        failure instanceof RevenueCatVerificationError &&
        failure.reason === "malformed",
    );
  }
});

test("current subscription product wins over pending changes", async () => {
  const access = await verifier(
    accessFetch([
      subscription("sub_weekly", WEEKLY_PRODUCT_RESOURCE_ID, {
        pendingProductId: MONTHLY_PRODUCT_RESOURCE_ID,
      }),
    ]),
  ).verifyAccess(APP_USER_ID);
  assert.deepEqual(access, { hasActivePro: true, plan: "weekly" });
});

test("simultaneously active Weekly and Monthly subscriptions use the stricter Weekly policy", async () => {
  const access = await verifier(
    accessFetch([
      subscription("sub_monthly", MONTHLY_PRODUCT_RESOURCE_ID),
      subscription("sub_weekly", WEEKLY_PRODUCT_RESOURCE_ID),
    ]),
  ).verifyAccess(APP_USER_ID);
  assert.deepEqual(access, { hasActivePro: true, plan: "weekly" });
});

test("unrelated active subscriptions do not affect the pro subscription plan", async () => {
  const access = await verifier(
    accessFetch([
      subscription("sub_other", "prod_other", {
        entitlementIds: ["entl_other"],
      }),
      subscription("sub_monthly", MONTHLY_PRODUCT_RESOURCE_ID),
    ]),
  ).verifyAccess(APP_USER_ID);
  assert.deepEqual(access, { hasActivePro: true, plan: "monthly" });
});

test("active entitlement and subscription pagination are completed before classification", async () => {
  const urls: string[] = [];
  const access = await verifier(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return entitlementResponse(
        [activeEntitlement("entl_other")],
        `${CUSTOMER_PATH}/active_entitlements?starting_after=entl_other`,
      );
    }
    if (urls.length === 2) {
      return entitlementResponse([
        activeEntitlement(PRO_ENTITLEMENT_RESOURCE_ID),
      ]);
    }
    if (urls.length === 3) {
      return subscriptionResponse(
        [
          subscription("sub_expired", WEEKLY_PRODUCT_RESOURCE_ID, {
            givesAccess: false,
          }),
        ],
        `${CUSTOMER_PATH}/subscriptions?starting_after=sub_expired`,
      );
    }
    return subscriptionResponse([
      subscription("sub_monthly", MONTHLY_PRODUCT_RESOURCE_ID),
    ]);
  }).verifyAccess(APP_USER_ID);

  assert.deepEqual(access, { hasActivePro: true, plan: "monthly" });
  assert.match(urls[1], /starting_after=entl_other/);
  assert.match(urls[3], /starting_after=sub_expired/);
});

test("network failures, timeouts, malformed payloads, and incomplete configuration fail closed", async () => {
  await assert.rejects(
    verifier(async () => {
      throw new Error("PRIVATE NETWORK FAILURE");
    }).verifyAccess(APP_USER_ID),
    (failure: unknown) =>
      failure instanceof RevenueCatVerificationError &&
      failure.reason === "unavailable" &&
      failure.operation === "active_entitlements" &&
      failure.category === "network",
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
    ).verifyAccess(APP_USER_ID),
    (failure: unknown) =>
      failure instanceof RevenueCatVerificationError &&
      failure.reason === "timeout" &&
      failure.operation === "active_entitlements" &&
      failure.category === "timeout_or_abort",
  );

  for (const payload of [
    null,
    {},
    { object: "list", items: "not-an-array", next_page: null, url: "/" },
  ]) {
    await assert.rejects(
      verifier(async () => Response.json(payload)).verifyAccess(APP_USER_ID),
      (failure: unknown) =>
        failure instanceof RevenueCatVerificationError &&
        failure.reason === "malformed" &&
        failure.operation === "active_entitlements" &&
        failure.category === "response_semantics",
    );
  }

  await assert.rejects(
    createRevenueCatEntitlementVerifier({
      apiKey: "server-secret",
      fetchImpl: async () => {
        throw new Error("must not call");
      },
      monthlyProductResourceId: "",
      proEntitlementResourceId: PRO_ENTITLEMENT_RESOURCE_ID,
      projectId: "proj_wingr",
      weeklyProductResourceId: WEEKLY_PRODUCT_RESOURCE_ID,
    }).verifyAccess(APP_USER_ID),
    (failure: unknown) =>
      failure instanceof RevenueCatVerificationError &&
      failure.reason === "configuration" &&
      failure.operation === "configuration" &&
      failure.category === "configuration",
  );
});
