// What a user consents to before a screenshot may be sent to an AI provider, and
// the helpers every AI endpoint uses to enforce it. This file is the single
// source of truth: the app imports the constants to show the consent text, the
// edge functions use them to validate and enforce it, and the database stores
// only a record of what was accepted.
//
// Bump AI_CONSENT_VERSION whenever the recipients or the wording change in a way
// that needs a fresh decision: every stored consent with another version stops
// counting, so all users are asked again.
export const AI_CONSENT_VERSION = "2026-11-v1";

// The recipients named in the consent text, in the words shown to the user.
export const AI_CONSENT_RECIPIENTS = [
  "OpenRouter",
  "Google Vertex AI",
] as const;
export const AI_CONSENT_RECIPIENTS_TEXT = AI_CONSENT_RECIPIENTS.join(" and ");
// The canonical form that is validated and stored.
export const AI_CONSENT_RECIPIENTS_KEY = AI_CONSENT_RECIPIENTS.join(", ");

// OpenRouter provider ids (the `provider.only` pin of the model presets) that
// the recipients above disclose. A request that would go to any other provider
// is refused before anything is sent, so a change of model or routing can never
// send data to an undisclosed provider. Add a provider here only together with
// updating AI_CONSENT_RECIPIENTS and bumping AI_CONSENT_VERSION.
export const CONSENT_COVERED_PROVIDERS: readonly string[] = [
  "google-vertex/global",
];

export function isProviderCoveredByConsent(provider: string) {
  return CONSENT_COVERED_PROVIDERS.includes(provider);
}

export function isCurrentConsent({
  recipients,
  version,
}: {
  recipients: unknown;
  version: unknown;
}) {
  return (
    version === AI_CONSENT_VERSION && recipients === AI_CONSENT_RECIPIENTS_KEY
  );
}

// The consent could not be checked (network, database, bad configuration). This
// is different from a missing consent: the caller must not treat it as "no".
export class ConsentVerificationError extends Error {
  constructor() {
    super("consent_verification_unavailable");
  }
}

export type ConsentVerifier = {
  // True only when this user has a current, non-withdrawn consent. Throws
  // ConsentVerificationError when the answer cannot be determined.
  hasConsent(authorization: string | null): Promise<boolean>;
};

const PROTECTION_TIMEOUT_MS = 5_000;

// Reads the caller's own consent with the caller's token (the database function
// uses auth.uid(), so a user can only ever read their own row).
export function createSupabaseConsentVerifier({
  fetchImpl = fetch,
  publishableKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  publishableKey: string;
  supabaseUrl: string;
}): ConsentVerifier {
  return {
    async hasConsent(authorization) {
      if (
        !authorization?.startsWith("Bearer ") ||
        !publishableKey ||
        !supabaseUrl
      )
        throw new ConsentVerificationError();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROTECTION_TIMEOUT_MS);
      try {
        const response = await fetchImpl(
          `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_ai_consent`,
          {
            method: "POST",
            headers: {
              apikey: publishableKey,
              authorization,
              "content-type": "application/json",
            },
            body: "{}",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new ConsentVerificationError();
        const result = await response.json();
        if (typeof result?.granted !== "boolean")
          throw new ConsentVerificationError();
        return result.granted === true && isCurrentConsent(result);
      } catch (failure) {
        if (failure instanceof ConsentVerificationError) throw failure;
        throw new ConsentVerificationError();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// Writes consent with the service role on behalf of a user whose token the
// edge function has already verified. Version, recipients and the timestamp are
// decided here and in the database, never taken from the client.
export type ConsentStore = {
  grant(userId: string): Promise<void>;
  withdraw(userId: string): Promise<void>;
};

export function createSupabaseConsentStore({
  fetchImpl = fetch,
  serviceRoleKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  serviceRoleKey: string;
  supabaseUrl: string;
}): ConsentStore {
  async function rpc(name: string, body: Record<string, unknown>) {
    if (!serviceRoleKey || !supabaseUrl) throw new ConsentVerificationError();
    let response: Response;
    try {
      response = await fetchImpl(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
        {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new ConsentVerificationError();
    }
    if (!response.ok) throw new ConsentVerificationError();
  }

  return {
    grant: (userId) =>
      rpc("record_ai_consent", {
        requested_recipients: AI_CONSENT_RECIPIENTS_KEY,
        requested_version: AI_CONSENT_VERSION,
        target_user_id: userId,
      }),
    withdraw: (userId) =>
      rpc("withdraw_ai_consent", { target_user_id: userId }),
  };
}
