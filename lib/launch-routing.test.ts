import assert from "node:assert/strict";
import test from "node:test";
import { resolveLaunchRoute, routeForCustomerInfo } from "./launch-routing";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
  type OnboardingProgressStorage,
} from "./onboarding-progress";

const customerInfo = (pro: boolean) => ({
  entitlements: { active: pro ? { pro: {} } : {} },
});
const hasProEntitlement = (value: ReturnType<typeof customerInfo>) =>
  value.entitlements.active.pro !== undefined;

function storage() {
  const values = new Map<string, string>();
  const adapter: OnboardingProgressStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { adapter, values };
}

function launchHarness({
  completed = false,
  pro,
}: {
  completed?: boolean;
  pro: boolean;
}) {
  const order: string[] = [];
  const userId = "00000000-0000-4000-8000-000000000101";
  return {
    order,
    resolve: () =>
      resolveLaunchRoute({
        async getAuthentication() {
          order.push("auth");
          return { userId };
        },
        async initializeRevenueCat(resolvedUserId) {
          assert.equal(resolvedUserId, userId);
          order.push("revenuecat_init");
          return true;
        },
        async getCustomerInfo() {
          order.push("customer_info");
          return customerInfo(pro);
        },
        hasProEntitlement,
        async hasCompletedOnboarding(resolvedUserId) {
          assert.equal(resolvedUserId, userId);
          order.push("onboarding_state");
          return completed;
        },
        async markOnboardingCompleted(resolvedUserId) {
          assert.equal(resolvedUserId, userId);
          order.push("mark_completed");
        },
      }),
  };
}

test("active Pro cold launch goes directly to main when completion only existed in memory", async () => {
  const harness = launchHarness({ pro: true });
  assert.deepEqual(await harness.resolve(), {
    route: "main",
    userId: "00000000-0000-4000-8000-000000000101",
  });
  assert.deepEqual(harness.order, [
    "auth",
    "revenuecat_init",
    "customer_info",
    "mark_completed",
  ]);
});

test("unavailable RevenueCat state does not fall through to onboarding", async () => {
  let readCustomerInfo = 0;
  await assert.rejects(
    resolveLaunchRoute({
      getAuthentication: async () => ({ userId: "user-a" }),
      initializeRevenueCat: async () => false,
      getCustomerInfo: async () => {
        readCustomerInfo++;
        return customerInfo(false);
      },
      hasProEntitlement,
      hasCompletedOnboarding: async () => false,
      markOnboardingCompleted: async () => {},
    }),
    /RevenueCat is unavailable/,
  );
  assert.equal(readCustomerInfo, 0);
});

test("launch does not choose onboarding while entitlement is loading", async () => {
  let releaseCustomerInfo!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseCustomerInfo = resolve;
  });
  let settled = false;
  const route = resolveLaunchRoute({
    getAuthentication: async () => ({ userId: "user-a" }),
    initializeRevenueCat: async () => true,
    getCustomerInfo: async () => {
      await waiting;
      return customerInfo(false);
    },
    hasProEntitlement,
    hasCompletedOnboarding: async () => false,
    markOnboardingCompleted: async () => {},
  }).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  releaseCustomerInfo();
  assert.equal((await route).route, "onboarding");
});

test("new non-Pro users enter onboarding and completed non-Pro users return to paywall", async () => {
  const newUser = launchHarness({ pro: false });
  assert.equal((await newUser.resolve()).route, "onboarding");
  const completedUser = launchHarness({ completed: true, pro: false });
  assert.equal((await completedUser.resolve()).route, "paywall");
});

test("onboarding completion is scoped to the authenticated identity", async () => {
  const { adapter } = storage();
  await markOnboardingCompleted("old-user", adapter);
  assert.equal(await hasCompletedOnboarding("old-user", adapter), true);
  assert.equal(await hasCompletedOnboarding("new-user", adapter), false);
});

test("RevenueCat customer updates move between the main app and the existing paywall route", async () => {
  assert.equal(
    await routeForCustomerInfo({
      customerInfo: customerInfo(true),
      hasProEntitlement,
      hasCompletedOnboarding: async () => false,
      markOnboardingCompleted: async () => {},
    }),
    "main",
  );
  assert.equal(
    await routeForCustomerInfo({
      customerInfo: customerInfo(false),
      hasProEntitlement,
      hasCompletedOnboarding: async () => true,
      markOnboardingCompleted: async () => {},
    }),
    "paywall",
  );
});
