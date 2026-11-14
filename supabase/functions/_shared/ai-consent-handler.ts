import {
  AI_CONSENT_RECIPIENTS_KEY,
  AI_CONSENT_VERSION,
  ConsentVerificationError,
  type ConsentStore,
  type ConsentVerifier,
} from "./ai-consent.ts";
import { handleCors } from "./cors.ts";
import { json } from "./http.ts";

export type AiConsentHandlerOptions = {
  getVerifiedUserId?: (accessToken: string) => Promise<string | null>;
  store?: ConsentStore;
  verifier?: ConsentVerifier;
};

const FAILURES = {
  authentication_verification_unavailable: 503,
  consent_verification_unavailable: 503,
  consent_version_mismatch: 409,
  invalid_request: 400,
  method_not_allowed: 405,
  unauthorized: 401,
} as const;

function failure(code: keyof typeof FAILURES) {
  return json({ code }, { status: FAILURES[code] });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

// Reads, records or withdraws the caller's AI consent.
//
// The user id always comes from the verified token, never from the body. On
// "accept" the client states which version and recipients it showed; they are
// only compared with the server's current configuration (a mismatch, for
// example an outdated app, is refused) and the values that are stored are the
// server's own. The database stamps the time.
export async function handleAiConsentRequest(
  request: Request,
  { getVerifiedUserId, store, verifier }: AiConsentHandlerOptions = {},
) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  if (request.method !== "POST") return failure("method_not_allowed");

  const accessToken = bearerToken(request);
  if (!accessToken) return failure("unauthorized");
  if (!getVerifiedUserId || !store || !verifier)
    return failure("authentication_verification_unavailable");

  let userId: string | null;
  try {
    userId = await getVerifiedUserId(accessToken);
  } catch {
    return failure("authentication_verification_unavailable");
  }
  const authenticatedUserId = userId?.trim() ?? "";
  if (!isUuid(authenticatedUserId)) return failure("unauthorized");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("invalid_request");
  }
  const action = (body as { action?: unknown } | null)?.action;

  try {
    if (action === "status") {
      const granted = await verifier.hasConsent(`Bearer ${accessToken}`);
      return json({ granted });
    }

    if (action === "withdraw") {
      await store.withdraw(authenticatedUserId);
      return json({ granted: false });
    }

    if (action === "accept") {
      const { recipients, version } = body as {
        recipients?: unknown;
        version?: unknown;
      };
      const shownRecipients = Array.isArray(recipients)
        ? recipients.join(", ")
        : null;
      if (
        version !== AI_CONSENT_VERSION ||
        shownRecipients !== AI_CONSENT_RECIPIENTS_KEY
      )
        return failure("consent_version_mismatch");
      await store.grant(authenticatedUserId);
      return json({ granted: true });
    }
  } catch (caught) {
    if (caught instanceof ConsentVerificationError)
      return failure("consent_verification_unavailable");
    throw caught;
  }

  return failure("invalid_request");
}
