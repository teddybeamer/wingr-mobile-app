import { createClient, type SupportedStorage } from "@supabase/supabase-js";

type SupabaseConfiguration = {
  publishableKey: string;
  url: string;
};

export type SupabaseRequestAuthentication = {
  accessToken: string;
  publishableKey: string;
};

const SESSION_EXPIRY_BUFFER_MS = 30_000;
let authenticationPromise: Promise<SupabaseRequestAuthentication> | null = null;
let clientConfiguration: SupabaseConfiguration | null = null;
let supabaseClient: ReturnType<typeof createClient> | null = null;

function configuredBackendUrl() {
  return process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(/\/$/, "");
}

export function getSupabaseConfiguration(): SupabaseConfiguration {
  const backendUrl = configuredBackendUrl();
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
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
    supabaseClient = createClient(configuration.url, configuration.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage: secureStorage,
      },
    });
  }
  return { configuration, client: supabaseClient };
}

async function createOrRefreshSession() {
  const { client, configuration } = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  let session = sessionData.session;
  if (
    session?.expires_at &&
    session.expires_at * 1000 <= Date.now() + SESSION_EXPIRY_BUFFER_MS
  ) {
    const { data, error } = await client.auth.refreshSession();
    if (error) throw error;
    session = data.session;
  }
  if (!session) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  if (!session?.access_token)
    throw new Error("Wingr could not start a secure identity session.");
  return { accessToken: session.access_token, publishableKey: configuration.publishableKey };
}

export function getSupabaseRequestAuthentication() {
  if (!authenticationPromise)
    authenticationPromise = createOrRefreshSession().finally(() => {
      authenticationPromise = null;
    });
  return authenticationPromise;
}
