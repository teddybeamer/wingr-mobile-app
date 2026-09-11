import {
  createClient,
  isAuthApiError,
  type SupportedStorage,
} from "@supabase/supabase-js";

type SupabaseConfiguration = {
  publishableKey: string;
  url: string;
};

export type SupabaseRequestAuthentication = {
  accessToken: string;
  publishableKey: string;
  userId: string;
};

const SESSION_EXPIRY_BUFFER_MS = 30_000;
let clientConfiguration: SupabaseConfiguration | null = null;
let supabaseClient: ReturnType<typeof createClient> | null = null;

function configuredBackendUrl() {
  return process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(/\/$/, "");
}

export function getSupabaseConfiguration(): SupabaseConfiguration {
  const backendUrl = configuredBackendUrl();
  const publishableKey =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const url = backendUrl?.replace(/\/functions\/v1$/, "");
  if (!url || !publishableKey)
    throw new Error("Wingr secure identity is not configured.");
  return { publishableKey, url };
}

const secureStorage: SupportedStorage = {
  async getItem(key) {
    if (typeof localStorage !== "undefined") return localStorage.getItem(key);
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(key);
  },
  async removeItem(key) {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
      return;
    }
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(key);
  },
  async setItem(key, value) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return;
    }
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(key, value);
  },
};

function getSupabaseClient() {
  const configuration = getSupabaseConfiguration();
  if (
    !supabaseClient ||
    clientConfiguration?.url !== configuration.url ||
    clientConfiguration?.publishableKey !== configuration.publishableKey
  ) {
    clientConfiguration = configuration;
    supabaseClient = createClient(
      configuration.url,
      configuration.publishableKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true,
          storage: secureStorage,
          storageKey: sessionStorageKey(configuration.url),
        },
      },
    );
  }
  return { configuration, client: supabaseClient };
}

function sessionStorageKey(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function isInvalidRefreshToken(error: unknown) {
  return (
    isAuthApiError(error) &&
    (error.status === 400 || error.status === 401) &&
    (error.code === "refresh_token_not_found" ||
      error.code === "refresh_token_already_used" ||
      (!error.code &&
        /^Invalid Refresh Token: (Refresh Token Not Found|Refresh Token Already Used|Refresh Token is missing|Invalid Refresh Token)$/i.test(
          error.message,
        )))
  );
}

// The shared promise includes recovery, so simultaneous requests share one identity.
export function createRequestAuthentication(
  getClient: typeof getSupabaseClient,
  clearSession: () => Promise<void>,
  allowAnonymousSignup = true,
  recoverInvalidSession = allowAnonymousSignup,
) {
  let pending: Promise<SupabaseRequestAuthentication> | null = null;
  async function initialize() {
    let { client, configuration } = getClient();
    let session;
    try {
      const { data: sessionData, error: sessionError } =
        await client.auth.getSession();
      if (sessionError) throw sessionError;
      session = sessionData.session;
      if (
        session?.expires_at &&
        session.expires_at * 1000 <= Date.now() + SESSION_EXPIRY_BUFFER_MS
      ) {
        const { data, error } = await client.auth.refreshSession();
        if (error) throw error;
        session = data.session;
      }
    } catch (error) {
      if (!isInvalidRefreshToken(error) || !recoverInvalidSession) throw error;
      await clearSession();
      ({ client, configuration } = getClient());
      session = null;
    }
    if (!session) {
      if (!allowAnonymousSignup)
        throw new Error("Wingr has no active account session.");
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    if (!session?.access_token || !session.user?.id)
      throw new Error("Wingr could not start a secure identity session.");
    return {
      accessToken: session.access_token,
      publishableKey: configuration.publishableKey,
      userId: session.user.id,
    };
  }
  return () => {
    if (!pending)
      pending = initialize().finally(() => {
        pending = null;
      });
    return pending;
  };
}

async function clearPersistedSupabaseSession() {
  const key = sessionStorageKey(getSupabaseConfiguration().url);
  await secureStorage.removeItem(key);
  await secureStorage.removeItem(`${key}-user`);
  await secureStorage.removeItem(`${key}-code-verifier`);
  supabaseClient = null;
  clientConfiguration = null;
}

/** Clears this installation's persisted identity without creating a replacement. */
export async function clearSupabaseAuthSession() {
  try {
    const { client } = getSupabaseClient();
    await client.auth.signOut({ scope: "local" });
  } catch {
    // The Auth record may already be deleted. The persisted session is removed below.
  }
  await clearPersistedSupabaseSession();
}

export const getSupabaseRequestAuthentication = createRequestAuthentication(
  getSupabaseClient,
  clearPersistedSupabaseSession,
);

// Account deletion must never create a replacement anonymous account just to delete it.
export const getExistingSupabaseRequestAuthentication =
  createRequestAuthentication(
    getSupabaseClient,
    clearPersistedSupabaseSession,
    false,
    false,
  );
