import {
  getExistingSupabaseRequestAuthentication,
  type SupabaseRequestAuthentication,
} from "./supabase-auth";

const DELETE_ACCOUNT_TIMEOUT_MS = 15_000;

export class AccountDeletionError extends Error {
  constructor() {
    super("Wingr could not delete your account. Please try again.");
    this.name = "AccountDeletionError";
  }
}

type DeleteAccountOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getAuthentication?: () => Promise<SupabaseRequestAuthentication>;
};

/** Deletes only the account represented by the caller's existing JWT. */
export async function deleteWingrAccount({
  baseUrl = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(/\/$/, ""),
  fetchImpl = fetch,
  getAuthentication = getExistingSupabaseRequestAuthentication,
}: DeleteAccountOptions = {}) {
  if (!baseUrl) throw new AccountDeletionError();

  let authentication: SupabaseRequestAuthentication;
  try {
    authentication = await getAuthentication();
  } catch {
    throw new AccountDeletionError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELETE_ACCOUNT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/delete-account`, {
      method: "POST",
      headers: {
        apikey: authentication.publishableKey,
        authorization: `Bearer ${authentication.accessToken}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new AccountDeletionError();
  } catch (error) {
    throw error instanceof AccountDeletionError
      ? error
      : new AccountDeletionError();
  } finally {
    clearTimeout(timeout);
  }
}
