import {
  ConversationError,
  CONVERSATION_ERROR_KINDS,
  type ConversationErrorKind,
} from "../supabase/functions/_shared/conversation";
import {
  getSupabaseRequestAuthentication,
  type SupabaseRequestAuthentication,
} from "./supabase-auth";

const BACKEND_TIMEOUT_MS = 35_000;

export async function postJsonToWingrBackend<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  getAuthentication: () => Promise<SupabaseRequestAuthentication> =
    getSupabaseRequestAuthentication,
): Promise<T> {
  // Expo inlines direct EXPO_PUBLIC env accesses in the app bundle.
  const baseUrl = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(
    /\/$/,
    "",
  );
  if (!baseUrl) throw new Error("Wingr backend URL is not configured.");
  let authentication: SupabaseRequestAuthentication;
  try {
    authentication = await getAuthentication();
  } catch {
    throw new Error("Wingr could not start a secure identity session.");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, BACKEND_TIMEOUT_MS);
  try {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr flow] backend fetch dispatched", { path });
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        apikey: authentication.publishableKey,
        authorization: `Bearer ${authentication.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr flow] backend response received", {
        path,
        status: response.status,
      });
    }
    if (!response.ok) {
      // Reconstruct only known errors. Never display arbitrary backend/provider text.
      let failure: {
        code?: unknown;
        providerStatus?: unknown;
        providerReason?: unknown;
        retryAt?: unknown;
      } | null = null;
      try {
        failure = await response.json();
      } catch {
        /* A gateway may return HTML. */
      }
      if (
        CONVERSATION_ERROR_KINDS.includes(
          failure?.code as ConversationErrorKind,
        )
      ) {
        throw new ConversationError(
          failure!.code as ConversationErrorKind,
          failure?.providerStatus,
          failure?.providerReason,
          failure?.retryAt,
        );
      }
      const kind =
        response.status === 400
          ? "invalid_request"
          : response.status === 422
            ? "unusable_screenshot"
            : response.status === 504
              ? "timeout"
              : "provider";
      throw new ConversationError(kind);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ConversationError("invalid_output");
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("Wingr took too long to respond. Please try again.");
    throw error instanceof ConversationError
      ? error
      : new ConversationError("provider");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
