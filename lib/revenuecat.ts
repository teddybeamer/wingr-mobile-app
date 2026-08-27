import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type MakePurchaseResult,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export const REVENUECAT_PRO_ENTITLEMENT_ID = 'pro';

const REVENUECAT_TEST_STORE_API_KEY = 'test_FvuyCnFJNducCpuqsWLtyzMhkoL';

let initializationPromise: Promise<boolean> | null = null;

function getProductionApiKey() {
  if (Platform.OS === 'ios') {
    return process?.env?.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  }

  if (Platform.OS === 'android') {
    return process?.env?.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
  }

  return undefined;
}

function getRevenueCatApiKey() {
  if (Platform.OS === 'web') {
    return undefined;
  }

  return typeof __DEV__ !== 'undefined' && __DEV__
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

      Purchases.configure({ apiKey });
      return true;
    })();
  }

  return initializationPromise;
}

async function requireRevenueCat() {
  if (!(await initializeRevenueCat())) {
    throw new Error('RevenueCat is not configured for this build.');
  }
}

export async function getRevenueCatCustomerInfo(): Promise<CustomerInfo> {
  await requireRevenueCat();
  return Purchases.getCustomerInfo();
}

export function hasProEntitlement(customerInfo: CustomerInfo) {
  return customerInfo.entitlements.active[REVENUECAT_PRO_ENTITLEMENT_ID] !== undefined;
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
