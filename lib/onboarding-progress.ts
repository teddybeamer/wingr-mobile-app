export const ONBOARDING_REPLY_DISPLAYED_KEY =
  "wingr.onboarding.reply-displayed.v1";
export const ONBOARDING_COMPLETED_KEY = "wingr.onboarding.completed.v1";

export type OnboardingProgressStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type AccountMarker = {
  userId: string;
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

async function hasAccountMarker(
  key: string,
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  const stored = await resolvedStorage.getItem(key);
  if (!stored) return false;
  try {
    const marker = JSON.parse(stored) as Partial<AccountMarker>;
    return marker.userId === userId;
  } catch {
    return false;
  }
}

async function setAccountMarker(
  key: string,
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  await resolvedStorage.setItem(key, JSON.stringify({ userId }));
}

export function hasDisplayedOnboardingReply(
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  return hasAccountMarker(ONBOARDING_REPLY_DISPLAYED_KEY, userId, storage);
}

export function markOnboardingReplyDisplayed(
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  return setAccountMarker(ONBOARDING_REPLY_DISPLAYED_KEY, userId, storage);
}

export function hasCompletedOnboarding(
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  return hasAccountMarker(ONBOARDING_COMPLETED_KEY, userId, storage);
}

export function markOnboardingCompleted(
  userId: string,
  storage?: OnboardingProgressStorage,
) {
  return setAccountMarker(ONBOARDING_COMPLETED_KEY, userId, storage);
}

export async function clearOnboardingReplyProgress(
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  await resolvedStorage.removeItem(ONBOARDING_REPLY_DISPLAYED_KEY);
}

export async function clearOnboardingCompletion(
  storage?: OnboardingProgressStorage,
) {
  const resolvedStorage = storage ?? (await getDefaultStorage());
  await resolvedStorage.removeItem(ONBOARDING_COMPLETED_KEY);
}
