import {
  ConversationError,
  type ConversationResult,
} from "./conversation.ts";
import type { DeviceCheckClient } from "./devicecheck.ts";

const RESULT_TTL_MS = 15 * 60 * 1000;

type EncryptedResult = { ciphertext: string; iv: string };
type TrialStatus =
  | "started"
  | "generation_in_progress"
  | "result_ready"
  | "finalized"
  | "replay"
  | "onboarding_reply_used"
  | "usage_limit"
  | "trial_unavailable";

type TrialResponse = {
  ciphertext?: unknown;
  iv?: unknown;
  retryAt?: unknown;
  status?: unknown;
};

export type OnboardingTrialStore = {
  abandon(userId: string, trialId: string, tokenHash: string): Promise<void>;
  begin(
    userId: string,
    trialId: string,
    tokenHash: string,
  ): Promise<TrialResponse>;
  finalize(
    userId: string,
    trialId: string,
    tokenHash: string,
  ): Promise<TrialResponse>;
  saveResult(
    userId: string,
    trialId: string,
    tokenHash: string,
    result: EncryptedResult,
  ): Promise<TrialResponse>;
};

export type TrialCipher = {
  decrypt(value: EncryptedResult): Promise<ConversationResult>;
  encrypt(value: ConversationResult): Promise<EncryptedResult>;
};

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toArrayBuffer(value: Uint8Array) {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

export function createTrialCipher(base64Key: string): TrialCipher {
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(base64Key);
  } catch {
    throw new Error("Invalid onboarding trial encryption key.");
  }
  if (keyBytes.byteLength !== 32)
    throw new Error("Invalid onboarding trial encryption key.");

  const keyPromise = crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

  return {
    async encrypt(value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await keyPromise,
        new TextEncoder().encode(JSON.stringify(value)),
      );
      return {
        ciphertext: bytesToBase64(new Uint8Array(encrypted)),
        iv: bytesToBase64(iv),
      };
    },
    async decrypt(value) {
      try {
        const decrypted = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: base64ToBytes(value.iv) },
          await keyPromise,
          base64ToBytes(value.ciphertext),
        );
        return JSON.parse(new TextDecoder().decode(decrypted)) as ConversationResult;
      } catch {
        throw new ConversationError("generation_protection_unavailable");
      }
    },
  };
}

export function createSupabaseOnboardingTrialStore({
  fetchImpl = fetch,
  serviceRoleKey,
  supabaseUrl,
}: {
  fetchImpl?: typeof fetch;
  serviceRoleKey: string;
  supabaseUrl: string;
}): OnboardingTrialStore {
  const rpc = async (
    userId: string,
    name: string,
    body: Record<string, unknown>,
  ) => {
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
          body: JSON.stringify({ requested_user_id: userId, ...body }),
        },
      );
    } catch {
      throw new ConversationError("generation_protection_unavailable");
    }
    if (!response.ok)
      throw new ConversationError("generation_protection_unavailable");
    try {
      return (await response.json()) as TrialResponse;
    } catch {
      throw new ConversationError("generation_protection_unavailable");
    }
  };
  const body = (trialId: string, tokenHash: string) => ({
    onboarding_trial_id: trialId,
    requested_device_token_hash: tokenHash,
  });
  return {
    async abandon(userId, trialId, tokenHash) {
      await rpc(userId, "abandon_onboarding_device_trial", body(trialId, tokenHash));
    },
    begin(userId, trialId, tokenHash) {
      return rpc(userId, "begin_onboarding_device_trial", body(trialId, tokenHash));
    },
    finalize(userId, trialId, tokenHash) {
      return rpc(userId, "finalize_onboarding_device_trial", body(trialId, tokenHash));
    },
    saveResult(userId, trialId, tokenHash, result) {
      return rpc(userId, "store_onboarding_device_trial_result", {
        ...body(trialId, tokenHash),
        encrypted_result: result.ciphertext,
        encrypted_result_iv: result.iv,
      });
    },
  };
}

function responseStatus(value: TrialResponse): TrialStatus {
  const status = value.status;
  if (
    status === "started" ||
    status === "generation_in_progress" ||
    status === "result_ready" ||
    status === "finalized" ||
    status === "replay" ||
    status === "onboarding_reply_used" ||
    status === "usage_limit" ||
    status === "trial_unavailable"
  )
    return status;
  throw new ConversationError("generation_protection_unavailable");
}

function encryptedResult(value: TrialResponse): EncryptedResult {
  if (typeof value.ciphertext !== "string" || typeof value.iv !== "string")
    throw new ConversationError("generation_protection_unavailable");
  return { ciphertext: value.ciphertext, iv: value.iv };
}

async function tokenHash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

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

export function createDeviceCheckOnboardingTrialManager({
  cipher,
  deviceCheck,
  store,
}: {
  cipher: TrialCipher;
  deviceCheck: DeviceCheckClient;
  store: OnboardingTrialStore;
}): OnboardingTrialManager {
  const readResult = (response: TrialResponse) => cipher.decrypt(encryptedResult(response));
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
    throw new ConversationError("generation_protection_unavailable");
  };

  return {
    async prepare({
      deviceToken,
      trialId,
      userId,
    }: {
      deviceToken: string;
      trialId: string;
      userId: string;
    }): Promise<OnboardingTrial> {
      const hashedToken = await tokenHash(deviceToken);
      const started = await store.begin(userId, trialId, hashedToken);
      const startedStatus = responseStatus(started);

      if (startedStatus === "replay") {
        return { kind: "replay", replay: await readResult(started), abandon: async () => {}, complete: async () => readResult(started) };
      }
      if (startedStatus === "result_ready") {
        try {
          await deviceCheck.markOnboardingPreviewUsed(deviceToken);
        } catch {
          throw new ConversationError("generation_protection_unavailable");
        }
        const finalized = await store.finalize(userId, trialId, hashedToken);
        const finalizedStatus = responseStatus(finalized);
        if (finalizedStatus !== "finalized" && finalizedStatus !== "replay")
          errorFor(finalizedStatus, finalized);
        const replay = await readResult(finalized);
        return { kind: "replay", replay, abandon: async () => {}, complete: async () => replay };
      }
      if (startedStatus !== "started") errorFor(startedStatus, started);

      let used: boolean;
      try {
        used = await deviceCheck.isOnboardingPreviewUsed(deviceToken);
      } catch (error) {
        await store.abandon(userId, trialId, hashedToken).catch(() => {});
        throw new ConversationError("generation_protection_unavailable");
      }
      if (used) {
        await store.abandon(userId, trialId, hashedToken).catch(() => {});
        throw new ConversationError("onboarding_device_reply_used");
      }

      let resultStored = false;
      return {
        kind: "generate",
        async abandon() {
          if (!resultStored)
            await store.abandon(userId, trialId, hashedToken).catch(() => {});
        },
        async complete(result) {
          const encrypted = await cipher.encrypt(result);
          const saved = await store.saveResult(
            userId,
            trialId,
            hashedToken,
            encrypted,
          );
          if (responseStatus(saved) !== "result_ready")
            errorFor(responseStatus(saved), saved);
          resultStored = true;
          try {
            await deviceCheck.markOnboardingPreviewUsed(deviceToken);
          } catch {
            throw new ConversationError("generation_protection_unavailable");
          }
          const finalized = await store.finalize(userId, trialId, hashedToken);
          const finalizedStatus = responseStatus(finalized);
          if (finalizedStatus !== "finalized" && finalizedStatus !== "replay")
            errorFor(finalizedStatus, finalized);
          return readResult(finalized);
        },
      };
    },
  };
}

export const ONBOARDING_TRIAL_RESULT_TTL_MS = RESULT_TTL_MS;
