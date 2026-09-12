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

export function createRevenueCatIdentityCoordinator() {
  let configured = false;
  let userId: string | null = null;

  return {
    currentUserId() {
      return userId;
    },
    async identify({
      apiKey,
      appUserID,
      configure,
      logIn,
    }: {
      apiKey: string;
      appUserID: string;
      configure: (configuration: { apiKey: string; appUserID: string }) => void;
      logIn: (appUserID: string) => Promise<unknown>;
    }) {
      if (!configured) {
        configure({ apiKey, appUserID });
        configured = true;
      } else if (userId !== appUserID) {
        await logIn(appUserID);
      }
      userId = appUserID;
    },
    async clear(logOut: () => Promise<unknown>) {
      userId = null;
      if (configured) await logOut();
    },
  };
}

export class RevenueCatPackageUnavailableError extends Error {
  constructor(plan: RevenueCatPlan) {
    super(`The RevenueCat ${plan} package is unavailable.`);
    this.name = "RevenueCatPackageUnavailableError";
  }
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
  onComplete: () => void | Promise<void>;
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
    await onComplete();
  }

  return unlocked;
}

export async function restoreAndComplete({
  onComplete,
  restorePurchases,
}: {
  onComplete: () => void | Promise<void>;
  restorePurchases: () => Promise<CustomerInfoLike>;
}) {
  const customerInfo = await restorePurchases();
  const unlocked = hasProEntitlement(customerInfo);

  if (unlocked) {
    await onComplete();
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
