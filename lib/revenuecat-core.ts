export const REVENUECAT_PRO_ENTITLEMENT_ID = "pro";

export type RevenueCatPlan = "weekly" | "monthly";

type CustomerInfoLike = {
  entitlements: {
    active: Record<string, unknown>;
  };
};

type OfferingLike<TPackage> = {
  monthly: TPackage | null;
  weekly: TPackage | null;
};

export class RevenueCatPackageUnavailableError extends Error {
  constructor(plan: RevenueCatPlan) {
    super(`The RevenueCat ${plan} package is unavailable.`);
    this.name = "RevenueCatPackageUnavailableError";
  }
}

export async function configureRevenueCatWithSupabaseUser({
  apiKey,
  configure,
  getAuthentication,
}: {
  apiKey: string;
  configure: (configuration: { apiKey: string; appUserID: string }) => void;
  getAuthentication: () => Promise<{ userId: string }>;
}) {
  const authentication = await getAuthentication();
  const appUserID = authentication.userId.trim();

  if (!appUserID) {
    throw new Error("Wingr could not identify the RevenueCat customer.");
  }

  configure({ apiKey, appUserID });
}

export function hasProEntitlement(customerInfo: CustomerInfoLike) {
  return (
    customerInfo.entitlements.active[REVENUECAT_PRO_ENTITLEMENT_ID] !==
    undefined
  );
}

export function getRevenueCatPackage<TPackage>(
  offering: OfferingLike<TPackage>,
  plan: RevenueCatPlan,
) {
  return offering[plan];
}

export async function purchasePlanAndComplete<TPackage>({
  offering,
  onComplete,
  plan,
  purchasePackage,
}: {
  offering: OfferingLike<TPackage>;
  onComplete: () => void;
  plan: RevenueCatPlan;
  purchasePackage: (
    selectedPackage: TPackage,
  ) => Promise<{ customerInfo: CustomerInfoLike }>;
}) {
  const selectedPackage = getRevenueCatPackage(offering, plan);

  if (!selectedPackage) {
    throw new RevenueCatPackageUnavailableError(plan);
  }

  const { customerInfo } = await purchasePackage(selectedPackage);
  const unlocked = hasProEntitlement(customerInfo);

  if (unlocked) {
    onComplete();
  }

  return unlocked;
}

export async function restoreAndComplete({
  onComplete,
  restorePurchases,
}: {
  onComplete: () => void;
  restorePurchases: () => Promise<CustomerInfoLike>;
}) {
  const customerInfo = await restorePurchases();
  const unlocked = hasProEntitlement(customerInfo);

  if (unlocked) {
    onComplete();
  }

  return unlocked;
}

export function isRevenueCatPurchaseCancelled(failure: unknown) {
  if (typeof failure !== "object" || failure === null) {
    return false;
  }

  const purchasesError = failure as {
    code?: unknown;
    userCancelled?: unknown;
  };

  return purchasesError.userCancelled === true || purchasesError.code === "1";
}
