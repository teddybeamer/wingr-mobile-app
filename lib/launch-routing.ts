export type LaunchRoute = "main" | "onboarding" | "paywall";

type CustomerInfoLike = {
  entitlements: {
    active: Record<string, unknown>;
  };
};

export async function routeForCustomerInfo({
  customerInfo,
  hasCompletedOnboarding,
  hasProEntitlement,
  markOnboardingCompleted,
}: {
  customerInfo: CustomerInfoLike;
  hasCompletedOnboarding: () => Promise<boolean>;
  hasProEntitlement: (customerInfo: CustomerInfoLike) => boolean;
  markOnboardingCompleted: () => Promise<void>;
}): Promise<LaunchRoute> {
  if (hasProEntitlement(customerInfo)) {
    await markOnboardingCompleted();
    return "main";
  }

  return (await hasCompletedOnboarding()) ? "paywall" : "onboarding";
}

export async function resolveLaunchRoute({
  getAuthentication,
  getCustomerInfo,
  hasCompletedOnboarding,
  hasProEntitlement,
  initializeRevenueCat,
  markOnboardingCompleted,
}: {
  getAuthentication: () => Promise<{ userId: string }>;
  getCustomerInfo: () => Promise<CustomerInfoLike>;
  hasCompletedOnboarding: (userId: string) => Promise<boolean>;
  hasProEntitlement: (customerInfo: CustomerInfoLike) => boolean;
  initializeRevenueCat: (userId: string) => Promise<boolean>;
  markOnboardingCompleted: (userId: string) => Promise<void>;
}) {
  const { userId } = await getAuthentication();
  if (!(await initializeRevenueCat(userId))) {
    throw new Error("RevenueCat is unavailable.");
  }
  const customerInfo = await getCustomerInfo();
  const route = await routeForCustomerInfo({
    customerInfo,
    hasCompletedOnboarding: () => hasCompletedOnboarding(userId),
    hasProEntitlement,
    markOnboardingCompleted: () => markOnboardingCompleted(userId),
  });
  return { route, userId };
}
