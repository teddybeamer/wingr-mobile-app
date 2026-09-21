import * as SecureStore from "expo-secure-store";
import { NativeModules, Platform } from "react-native";
import { ConversationError } from "../supabase/functions/_shared/conversation";

const ONBOARDING_TRIAL_ID_KEY = "wingr.onboarding.device-check.trial-id";

type WingrDeviceCheckModule = {
  generateToken(): Promise<string>;
};

function createTrialId() {
  const bytes = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export type OnboardingDeviceCheck = {
  deviceCheckToken: string;
  onboardingTrialId: string;
};

/**
 * DeviceCheck is only used for iOS onboarding. Android keeps its existing
 * account-scoped trial path until it has a comparable integrity provider.
 */
export async function getOnboardingDeviceCheck(): Promise<
  OnboardingDeviceCheck | undefined
> {
  if (Platform.OS !== "ios") return undefined;

  const module = NativeModules.WingrDeviceCheck as
    | WingrDeviceCheckModule
    | undefined;
  if (!module?.generateToken)
    throw new ConversationError("generation_protection_unavailable");

  let deviceCheckToken: string;
  try {
    deviceCheckToken = await module.generateToken();
  } catch {
    throw new ConversationError("generation_protection_unavailable");
  }
  if (!deviceCheckToken.trim())
    throw new ConversationError("generation_protection_unavailable");

  let existing: string | null;
  try {
    existing = await SecureStore.getItemAsync(ONBOARDING_TRIAL_ID_KEY);
  } catch {
    throw new ConversationError("generation_protection_unavailable");
  }
  const onboardingTrialId =
    existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
      ? existing
      : createTrialId();
  if (onboardingTrialId !== existing) {
    try {
      await SecureStore.setItemAsync(ONBOARDING_TRIAL_ID_KEY, onboardingTrialId);
    } catch {
      throw new ConversationError("generation_protection_unavailable");
    }
  }

  return { deviceCheckToken, onboardingTrialId };
}

export async function clearOnboardingDeviceCheckTrial() {
  try {
    await SecureStore.deleteItemAsync(ONBOARDING_TRIAL_ID_KEY);
  } catch {
    // Retaining the ID is safe: a retry only receives the cached result.
  }
}
