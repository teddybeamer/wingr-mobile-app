export const ONBOARDING_REPLY_DISPLAYED_KEY =
  "wingr.onboarding.reply-displayed.v1";

export type OnboardingProgressStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

async function getDefaultStorage(): Promise<OnboardingProgressStorage> {
  if (typeof localStorage !== "undefined") {
    return {
      getItem: async (key) => localStorage.getItem(key),
      setItem: async (key, value) => localStorage.setItem(key, value),
      removeItem: async (key) => localStorage.removeItem(key),
    };
  }
  const SecureStore = await import("expo-secure-store");
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

export async function hasDisplayedOnboardingReply(
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  return (
    (await resolvedStorage.getItem(ONBOARDING_REPLY_DISPLAYED_KEY)) === "true"
  );
}

export async function markOnboardingReplyDisplayed(
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  await resolvedStorage.setItem(ONBOARDING_REPLY_DISPLAYED_KEY, "true");
}

export async function clearOnboardingReplyProgress(
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  await resolvedStorage.removeItem(ONBOARDING_REPLY_DISPLAYED_KEY);
}
