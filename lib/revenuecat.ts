import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  type MakePurchaseResult,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import { getSupabaseRequestAuthentication } from "./supabase-auth";
import {
  createRevenueCatIdentityCoordinator,
  hasProEntitlement,
  selectRevenueCatApiKey,
} from "./revenuecat-core";

export {
  hasProEntitlement,
  REVENUECAT_PRO_ENTITLEMENT_ID,
} from "./revenuecat-core";

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const REVENUECAT_TEST_STORE_API_KEY = "test_FvuyCnFJNducCpuqsWLtyzMhkoL";

let initializationPromise: Promise<boolean> | null = null;
const revenueCatIdentity = createRevenueCatIdentityCoordinator();

function getProductionApiKey() {
  if (Platform.OS === "ios") {
    // Expo statically replaces direct EXPO_PUBLIC_* access in native bundles.
    // @ts-expect-error Metro injects process.env at bundle time.
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  }

  if (Platform.OS === "android") {
    // Expo statically replaces direct EXPO_PUBLIC_* access in native bundles.
    // @ts-expect-error Metro injects process.env at bundle time.
    return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
  }

  return undefined;
}

function isExplicitStagingIosBuild() {
  if (Platform.OS !== "ios") return false;
  // Expo statically replaces direct EXPO_PUBLIC_* access in native bundles.
  // @ts-expect-error Metro injects process.env at bundle time.
  return process.env.EXPO_PUBLIC_WINGR_STAGING === "1";
}

function getRevenueCatApiKey() {
  if (Platform.OS === "web") {
    return undefined;
  }

  return selectRevenueCatApiKey({
    appStoreApiKey: getProductionApiKey(),
    isDevelopment: typeof __DEV__ !== "undefined" && __DEV__,
    isExplicitStagingIosBuild: isExplicitStagingIosBuild(),
    testStoreApiKey: REVENUECAT_TEST_STORE_API_KEY,
  });
}

export function initializeRevenueCat(authenticatedUserId?: string) {
  const requestedUserId = authenticatedUserId?.trim() || null;
  if (
    initializationPromise &&
    requestedUserId &&
    revenueCatIdentity.currentUserId() !== requestedUserId
  ) {
    initializationPromise = null;
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const apiKey = getRevenueCatApiKey();

      if (!apiKey) {
        return false;
      }

      const appUserID =
        requestedUserId ??
        (await getSupabaseRequestAuthentication()).userId.trim();
      if (!appUserID) {
        throw new Error("Wingr could not identify the RevenueCat customer.");
      }

      await revenueCatIdentity.identify({
        apiKey,
        appUserID,
        configure: (configuration) => Purchases.configure(configuration),
        logIn: (userId) => Purchases.logIn(userId),
      });
      return true;
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

export function subscribeToRevenueCatCustomerInfo(
  listener: CustomerInfoUpdateListener,
) {
  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}

export async function clearRevenueCatIdentity() {
  initializationPromise = null;
  await revenueCatIdentity.clear(() => Purchases.logOut());
}

async function requireRevenueCat() {
  if (!(await initializeRevenueCat())) {
    throw new Error("RevenueCat is not configured for this build.");
  }
}

export async function getRevenueCatCustomerInfo(): Promise<CustomerInfo> {
  await requireRevenueCat();
  return Purchases.getCustomerInfo();
}

export async function isProActive() {
  return hasProEntitlement(await getRevenueCatCustomerInfo());
}

export async function getRevenueCatOfferings(): Promise<PurchasesOfferings> {
  await requireRevenueCat();
  return Purchases.getOfferings();
}

export async function purchaseRevenueCatPackage(
  selectedPackage: PurchasesPackage,
): Promise<MakePurchaseResult> {
  await requireRevenueCat();
  return Purchases.purchasePackage(selectedPackage);
}

export async function restoreRevenueCatPurchases(): Promise<CustomerInfo> {
  await requireRevenueCat();
  return Purchases.restorePurchases();
}
