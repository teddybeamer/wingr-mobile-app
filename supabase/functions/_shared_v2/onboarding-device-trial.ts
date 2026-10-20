import { ConversationError } from "./conversation.ts";
import type { ConversationResult } from "./conversation.ts";
import type { DeviceCheckClient } from "../_shared/devicecheck.ts";
import {
  createSupabaseOnboardingTrialStore as createSharedOnboardingTrialStore,
  type OnboardingTrialStore,
} from "../_shared/onboarding-device-trial.ts";

// The shared cipher encrypts and decrypts the validated result as opaque JSON, so
// it serves the compact (v2) result, which has no `messages`, unchanged.
type EncryptedResult = { ciphertext: string; iv: string };
export type TrialCipher = {
  decrypt(value: EncryptedResult): Promise<ConversationResult>;
  encrypt(value: ConversationResult): Promise<EncryptedResult>;
};

// The free onboarding reply is one per device, and only a valid reply uses it:
//   - Apple DeviceCheck bit 0 is the durable per-device marker. It is set, and the
//     account claim is made, only after a valid reply has been generated and stored.
//   - Every failure (provider, timeout, invalid output, unusable screenshot, Apple
//     or database errors before the reply is stored) abandons the trial and costs
//     nothing, so the user can simply try again.
//
// Differences from ../_shared/onboarding-device-trial.ts, which the frozen v1
// endpoint keeps using:
//   1. The database row is bound to the trial ID instead of to the DeviceCheck
//      token. A DeviceCheck token is generated per request, so a retry carries a
//      different token; binding to the token made every retry of an interrupted
//      trial fail with "Trial does not belong to this device" until the row expired.
//   2. The free reply is not an attempt: finalizing makes the account claim but
//      records no ai_generation_attempts row, so it never reduces the Weekly or
//      Monthly allowance (see createSupabaseOnboardingTrialStore below).
//   3. DeviceCheck is queried again just before the reply is stored. Two requests
//      from one device that both passed the first check cannot both finish: the
//      later one finds the bit already set and returns nothing.

export type OnboardingTrial = {
  abandon(): Promise<void>;
  complete(result: ConversationResult): Promise<ConversationResult>;
  kind: "generate" | "replay";
  replay?: ConversationResult;
};

export type OnboardingTrialManager = {
  prepare(args: {
    deviceToken: string;
    trialId: string;
    userId: string;
  }): Promise<OnboardingTrial>;
};

type TrialResponse = Awaited<ReturnType<OnboardingTrialStore["begin"]>>;
type TrialStatus =
  | "started"
  | "generation_in_progress"
  | "result_ready"
  | "finalized"
  | "replay"
  | "onboarding_reply_used"
  | "usage_limit"
  | "trial_unavailable";

const TRIAL_STATUSES: readonly unknown[] = [
  "started",
  "generation_in_progress",
  "result_ready",
  "finalized",
  "replay",
  "onboarding_reply_used",
  "usage_limit",
  "trial_unavailable",
];

const protectionFailure = () =>
  new ConversationError("generation_protection_unavailable");

function responseStatus(value: TrialResponse): TrialStatus {
  if (!TRIAL_STATUSES.includes(value.status)) throw protectionFailure();
  return value.status as TrialStatus;
}

function encryptedResult(value: TrialResponse) {
  if (typeof value.ciphertext !== "string" || typeof value.iv !== "string")
    throw protectionFailure();
  return { ciphertext: value.ciphertext, iv: value.iv };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createDeviceCheckOnboardingTrialManager({
  cipher,
  deviceCheck,
  store,
}: {
  cipher: TrialCipher;
  deviceCheck: DeviceCheckClient;
  store: OnboardingTrialStore;
}): OnboardingTrialManager {
  const readResult = (response: TrialResponse) =>
    cipher.decrypt(encryptedResult(response));
  const errorFor = (status: TrialStatus, response: TrialResponse): never => {
    if (status === "generation_in_progress")
      throw new ConversationError(
        "generation_in_progress",
        undefined,
        undefined,
        response.retryAt,
      );
    if (status === "onboarding_reply_used")
      throw new ConversationError("onboarding_reply_used");
    if (status === "usage_limit") throw new ConversationError("usage_limit");
    throw protectionFailure();
  };
  const markUsed = async (deviceToken: string) => {
    try {
      await deviceCheck.markOnboardingPreviewUsed(deviceToken);
    } catch {
      throw protectionFailure();
    }
  };
  const finalize = async (userId: string, trialId: string, binding: string) => {
    const finalized = await store.finalize(userId, trialId, binding);
    const status = responseStatus(finalized);
    if (status !== "finalized" && status !== "replay")
      errorFor(status, finalized);
    return readResult(finalized);
  };

  return {
    async prepare({ deviceToken, trialId, userId }) {
      // Stable across the retries of one trial, unlike the per-request token.
      const binding = await sha256Hex(trialId);
      const started = await store.begin(userId, trialId, binding);
      const startedStatus = responseStatus(started);

      if (startedStatus === "replay") {
        const replay = await readResult(started);
        return {
          kind: "replay",
          replay,
          abandon: async () => {},
          complete: async () => replay,
        };
      }
      if (startedStatus === "result_ready") {
        // A valid reply was stored but the device was not marked, or finalizing
        // failed afterwards. Finish that without another model call.
        await markUsed(deviceToken);
        const replay = await finalize(userId, trialId, binding);
        return {
          kind: "replay",
          replay,
          abandon: async () => {},
          complete: async () => replay,
        };
      }
      if (startedStatus !== "started") errorFor(startedStatus, started);

      const abandon = () =>
        store.abandon(userId, trialId, binding).catch(() => {});
      let used: boolean;
      try {
        used = await deviceCheck.isOnboardingPreviewUsed(deviceToken);
      } catch {
        await abandon();
        throw protectionFailure();
      }
      if (used) {
        await abandon();
        throw new ConversationError("onboarding_device_reply_used");
      }

      let resultStored = false;
      return {
        kind: "generate",
        async abandon() {
          if (!resultStored) await abandon();
        },
        async complete(result) {
          // Generation took seconds, during which another request from this
          // device may have finished. Looking again narrows the window in which
          // two replies can be released from seconds to one storage round trip.
          let usedMeanwhile: boolean;
          try {
            usedMeanwhile =
              await deviceCheck.isOnboardingPreviewUsed(deviceToken);
          } catch {
            throw protectionFailure();
          }
          if (usedMeanwhile)
            throw new ConversationError("onboarding_device_reply_used");

          const encrypted = await cipher.encrypt(result);
          const saved = await store.saveResult(
            userId,
            trialId,
            binding,
            encrypted,
          );
          const savedStatus = responseStatus(saved);
          if (savedStatus !== "result_ready") errorFor(savedStatus, saved);
          resultStored = true;
          await markUsed(deviceToken);
          return finalize(userId, trialId, binding);
        },
      };
    },
  };
}

// The shared store, except finalizing calls finalize_onboarding_device_trial_v2,
// which does not record an attempt. The original function keeps doing so for the
// frozen v1 endpoint.
export function createSupabaseOnboardingTrialStore({
  fetchImpl = fetch,
  serviceRoleKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  serviceRoleKey: string;
  supabaseUrl: string;
}): OnboardingTrialStore {
  return {
    ...createSharedOnboardingTrialStore({
      fetchImpl,
      serviceRoleKey,
      supabaseUrl,
    }),
    async finalize(userId, trialId, tokenHash) {
      let response: Response;
      try {
        response = await fetchImpl(
          `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/finalize_onboarding_device_trial_v2`,
          {
            method: "POST",
            headers: {
              apikey: serviceRoleKey,
              authorization: `Bearer ${serviceRoleKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              requested_user_id: userId,
              onboarding_trial_id: trialId,
              requested_device_token_hash: tokenHash,
            }),
          },
        );
      } catch {
        throw protectionFailure();
      }
      if (!response.ok) throw protectionFailure();
      try {
        return (await response.json()) as Awaited<
          ReturnType<OnboardingTrialStore["finalize"]>
        >;
      } catch {
        throw protectionFailure();
      }
    },
  };
}
