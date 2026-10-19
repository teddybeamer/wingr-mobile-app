import {
  ConversationError,
  CONVERSATION_ERROR_KINDS,
  isUnusableScreenshotReason,
  type ConversationErrorKind,
  type UnusableScreenshotReason,
} from "../supabase/functions/_shared_v2/conversation";
import {
  getSupabaseRequestAuthentication,
  type SupabaseRequestAuthentication,
} from "./supabase-auth";

const BACKEND_TIMEOUT_MS = 35_000;

const ACCESS_ERROR_CODES = [
  "authentication_verification_unavailable",
  "subscription_required",
  "subscription_verification_unavailable",
  "unauthorized",
] as const;
export type BackendErrorCode =
  | ConversationErrorKind
  | (typeof ACCESS_ERROR_CODES)[number];

function isBackendErrorCode(value: unknown): value is BackendErrorCode {
  return (
    CONVERSATION_ERROR_KINDS.includes(value as ConversationErrorKind) ||
    ACCESS_ERROR_CODES.includes(value as (typeof ACCESS_ERROR_CODES)[number])
  );
}

function kindForResponse(status: number, code: BackendErrorCode | undefined) {
  if (code && CONVERSATION_ERROR_KINDS.includes(code as ConversationErrorKind))
    return code as ConversationErrorKind;
  return status === 400
    ? "invalid_request"
    : status === 413
      ? "payload_too_large"
      : status === 422
        ? "unusable_screenshot"
        : status === 504
          ? "timeout"
          : "provider";
}

export class ConversationApiError extends ConversationError {
  readonly failureReason?: UnusableScreenshotReason;

  constructor(
    kind: ConversationErrorKind,
    public readonly errorCode: BackendErrorCode,
    public readonly httpStatus?: number,
    reason?: unknown,
    retryAt?: unknown,
  ) {
    super(kind, undefined, undefined, retryAt);
    if (kind === "unusable_screenshot") {
      this.failureReason = isUnusableScreenshotReason(reason)
        ? reason
        : "unknown";
    }
  }
}

export async function postJsonToWingrBackend<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  getAuthentication: () => Promise<SupabaseRequestAuthentication> = getSupabaseRequestAuthentication,
): Promise<T> {
  // Expo inlines direct EXPO_PUBLIC env accesses in the app bundle.
  const baseUrl = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL?.trim().replace(
    /\/$/,
    "",
  );
  if (!baseUrl) throw new Error("WiNGR backend URL is not configured.");
  let authentication: SupabaseRequestAuthentication;
  try {
    authentication = await getAuthentication();
  } catch {
    throw new Error("WiNGR could not start a secure identity session.");
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
        reason?: unknown;
        retryAt?: unknown;
      } | null = null;
      try {
        failure = await response.json();
      } catch {
        /* A gateway may return HTML. */
      }
      const errorCode = isBackendErrorCode(failure?.code)
        ? failure.code
        : undefined;
      const kind = kindForResponse(response.status, errorCode);
      throw new ConversationApiError(
        kind,
        errorCode ?? kind,
        response.status,
        failure?.reason,
        failure?.retryAt,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ConversationApiError("invalid_output", "invalid_output");
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new ConversationApiError("timeout", "timeout");
    throw error instanceof ConversationError
      ? error
      : new ConversationApiError("provider", "provider");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
