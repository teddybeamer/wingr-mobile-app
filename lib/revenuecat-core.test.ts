import assert from "node:assert/strict";
import test from "node:test";
import {
  createRevenueCatIdentityCoordinator,
  isRevenueCatPurchaseCancelled,
  purchasePlanAndComplete,
  restoreAndComplete,
} from "./revenuecat-core";

const weeklyPackage = {
  identifier: "$rc_weekly",
  product: { priceString: "$4.99" },
};
const monthlyPackage = {
  identifier: "$rc_monthly",
  product: { priceString: "$9.99" },
};
const offering = { monthly: monthlyPackage, weekly: weeklyPackage };
const customerInfo = (pro: boolean) => ({
  entitlements: { active: pro ? { pro: { isActive: true } } : {} },
});

test("RevenueCat replaces a deleted account identity without reconfiguring the SDK", async () => {
  const identity = createRevenueCatIdentityCoordinator();
  const calls: string[] = [];
  const dependencies = {
    apiKey: "public-key",
    configure: ({ appUserID }: { apiKey: string; appUserID: string }) => {
      calls.push(`configure:${appUserID}`);
    },
    logIn: async (appUserID: string) => {
      calls.push(`login:${appUserID}`);
    },
  };
  await identity.identify({ ...dependencies, appUserID: "old-user" });
  await identity.clear(async () => {
    calls.push("logout");
  });
  await identity.identify({ ...dependencies, appUserID: "new-user" });
  assert.equal(identity.currentUserId(), "new-user");
  assert.deepEqual(calls, [
    "configure:old-user",
    "logout",
    "login:new-user",
  ]);
});

for (const [plan, expectedPackage] of [
  ["weekly", weeklyPackage],
  ["monthly", monthlyPackage],
] as const) {
  test(`${plan} purchase uses the offering's ${plan} package`, async () => {
    let purchasedPackage;
    let completed = 0;

    const unlocked = await purchasePlanAndComplete({
      offering,
      onComplete: () => {
        completed++;
      },
      plan,
      async purchasePackage(selectedPackage) {
        purchasedPackage = selectedPackage;
        return { customerInfo: customerInfo(true) };
      },
    });

    assert.equal(purchasedPackage, expectedPackage);
    assert.equal(unlocked, true);
    assert.equal(completed, 1);
  });
}

test("successful purchase with pro completes onboarding", async () => {
  let completed = 0;

  const unlocked = await purchasePlanAndComplete({
    offering,
    onComplete: () => {
      completed++;
    },
    plan: "monthly",
    purchasePackage: async () => ({ customerInfo: customerInfo(true) }),
  });

  assert.equal(unlocked, true);
  assert.equal(completed, 1);
});

test("successful purchase without pro does not complete onboarding", async () => {
  let completed = 0;

  const unlocked = await purchasePlanAndComplete({
    offering,
    onComplete: () => {
      completed++;
    },
    plan: "monthly",
    purchasePackage: async () => ({ customerInfo: customerInfo(false) }),
  });

  assert.equal(unlocked, false);
  assert.equal(completed, 0);
});

for (const [name, failure] of [
  ["cancelled", { code: "1", userCancelled: true }],
  ["failed", new Error("store unavailable")],
] as const) {
  test(`${name} purchase rejects and does not complete onboarding`, async () => {
    let completed = 0;

    await assert.rejects(
      purchasePlanAndComplete({
        offering,
        onComplete: () => {
          completed++;
        },
        plan: "weekly",
        purchasePackage: async () => {
          throw failure;
        },
      }),
      (error) => error === failure,
    );

    assert.equal(completed, 0);
    assert.equal(isRevenueCatPurchaseCancelled(failure), name === "cancelled");
  });
}

for (const pro of [true, false]) {
  test(`restore ${pro ? "with" : "without"} pro ${
    pro ? "completes" : "does not complete"
  } onboarding`, async () => {
    let completed = 0;

    const unlocked = await restoreAndComplete({
      onComplete: () => {
        completed++;
      },
      restorePurchases: async () => customerInfo(pro),
    });

    assert.equal(unlocked, pro);
    assert.equal(completed, pro ? 1 : 0);
  });
}
