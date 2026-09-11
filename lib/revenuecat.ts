import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type MakePurchaseResult,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";
import { getSupabaseRequestAuthentication } from "./supabase-auth";
import {
  configureRevenueCatWithSupabaseUser,
  hasProEntitlement,
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

function getProductionApiKey() {
  if (Platform.OS === "ios") {
    return process?.env?.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  }

  if (Platform.OS === "android") {
    return process?.env?.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
  }

  return undefined;
}

function getRevenueCatApiKey() {
  if (Platform.OS === "web") {
    return undefined;
  }

  return typeof __DEV__ !== "undefined" && __DEV__
    ? REVENUECAT_TEST_STORE_API_KEY
    : getProductionApiKey();
}

export function initializeRevenueCat() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const apiKey = getRevenueCatApiKey();

      if (!apiKey) {
        return false;
      }

      await configureRevenueCatWithSupabaseUser({
        apiKey,
        configure: (configuration) => Purchases.configure(configuration),
        getAuthentication: getSupabaseRequestAuthentication,
      });
      return true;
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
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
