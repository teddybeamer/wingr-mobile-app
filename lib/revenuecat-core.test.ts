import assert from "node:assert/strict";
import test from "node:test";
import {
  configureRevenueCatWithSupabaseUser,
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

test("RevenueCat is configured with the authenticated Supabase UUID", async () => {
  const calls: string[] = [];
  let configuration: { apiKey: string; appUserID: string } | undefined;

  await configureRevenueCatWithSupabaseUser({
    apiKey: "test_public_key",
    configure(value) {
      calls.push("configure");
      configuration = value;
    },
    async getAuthentication() {
      calls.push("authenticate");
      return { userId: "7ebf38e2-8505-4aa9-893c-16a4c46cb262" };
    },
  });

  assert.deepEqual(calls, ["authenticate", "configure"]);
  assert.deepEqual(configuration, {
    apiKey: "test_public_key",
    appUserID: "7ebf38e2-8505-4aa9-893c-16a4c46cb262",
  });
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
