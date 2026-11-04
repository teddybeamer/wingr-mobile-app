import {
  AI_CONSENT_RECIPIENTS,
  AI_CONSENT_VERSION,
} from "../supabase/functions/_shared/ai-consent";
import {
  getDefaultStorage,
  type OnboardingProgressStorage,
} from "./onboarding-progress";
import { getSupabaseRequestAuthentication } from "./supabase-auth";
import { postJsonToWingrBackend } from "./wingr-api";

export const AI_CONSENT_CACHE_KEY = "wingr.ai-consent.v1";
export { AI_CONSENT_RECIPIENTS, AI_CONSENT_VERSION };

// What the user is shown and agrees to (shown by the consent popup). The
// recipients and the version come from the same file the server enforces, so the
// words on screen and the check on the server cannot drift.
export const AI_CONSENT_TITLE = "Your chats. Your choice.";
export const AI_CONSENT_PARAGRAPHS = [
  "WiNGR uses AI to read the vibe and help you craft better replies.",
  "Your screenshots are shared with OpenRouter and Google Vertex AI for AI processing.",
  "We use Zero Data Retention to help keep your conversations private.",
  "Tap I Accept to allow this. You can change your mind anytime in the three-dot menu.",
] as const;
export const PRIVACY_POLICY_URL = "https://trywingr.com/privacy";

export type ConsentApi = {
  accept(): Promise<void>;
  status(): Promise<boolean>;
  withdraw(): Promise<void>;
};

// granted      the server (or a still valid cache of it) says yes
// missing      the server answered and there is no current consent: ask the user
// unavailable  the answer could not be determined (network, server error): this
//              is NOT "missing", so the user is not asked again for nothing
export type ConsentState = "granted" | "missing" | "unavailable";

type CacheEntry = { userId: string; version: string };

// The cache only exists so a granted consent does not need a request every time.
// It can never grant anything: every AI request is checked by the server again.
// It counts only for the same user and the same consent version, so switching
// account or changing the consent text invalidates it by itself.
export function createAiConsentController({
  api,
  getUserId,
  storage,
}: {
  api: ConsentApi;
  getUserId: () => Promise<string>;
  storage: () => Promise<OnboardingProgressStorage>;
}) {
  async function readCache(userId: string) {
    try {
      const stored = await (await storage()).getItem(AI_CONSENT_CACHE_KEY);
      if (!stored) return false;
      const entry = JSON.parse(stored) as Partial<CacheEntry>;
      return entry.userId === userId && entry.version === AI_CONSENT_VERSION;
    } catch {
      return false;
    }
  }

  async function writeCache(userId: string) {
    try {
      const entry: CacheEntry = { userId, version: AI_CONSENT_VERSION };
      await (
        await storage()
      ).setItem(AI_CONSENT_CACHE_KEY, JSON.stringify(entry));
    } catch {
      // Without a cache the next check simply asks the server.
    }
  }

  async function clearCache() {
    try {
      await (await storage()).removeItem(AI_CONSENT_CACHE_KEY);
    } catch {
      // The server stays authoritative either way.
    }
  }

  return {
    async accept() {
      const userId = await getUserId();
      await api.accept();
      await writeCache(userId);
    },
    // Forgets the cached answer (for example after the server refused a request).
    invalidate: clearCache,
    async check({
      verifyWithServer = false,
    }: { verifyWithServer?: boolean } = {}): Promise<ConsentState> {
      let userId: string;
      try {
        userId = await getUserId();
      } catch {
        return "unavailable";
      }
      if (!verifyWithServer && (await readCache(userId))) return "granted";
      try {
        if (await api.status()) {
          await writeCache(userId);
          return "granted";
        }
        await clearCache();
        return "missing";
      } catch {
        return "unavailable";
      }
    },
    async withdraw() {
      await api.withdraw();
      await clearCache();
    },
  };
}

const backendApi: ConsentApi = {
  async accept() {
    await postJsonToWingrBackend("/ai-consent", {
      action: "accept",
      recipients: [...AI_CONSENT_RECIPIENTS],
      version: AI_CONSENT_VERSION,
    });
  },
  async status() {
    const result = await postJsonToWingrBackend<{ granted?: unknown }>(
      "/ai-consent",
      { action: "status" },
    );
    if (typeof result?.granted !== "boolean") throw new Error("Bad response");
    return result.granted;
  },
  async withdraw() {
    await postJsonToWingrBackend("/ai-consent", { action: "withdraw" });
  },
};

export const aiConsent = createAiConsentController({
  api: backendApi,
  getUserId: async () => (await getSupabaseRequestAuthentication()).userId,
  storage: getDefaultStorage,
});

// Used when the account is deleted or reset on this device.
export async function clearAiConsentCache() {
  try {
    await (await getDefaultStorage()).removeItem(AI_CONSENT_CACHE_KEY);
  } catch {
    // Nothing to clear.
  }
}
