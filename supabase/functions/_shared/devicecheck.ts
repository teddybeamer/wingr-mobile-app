const APPLE_DEVICECHECK_PRODUCTION_URL =
  "https://api.devicecheck.apple.com/v1";
const APPLE_DEVICECHECK_DEVELOPMENT_URL =
  "https://api.development.devicecheck.apple.com/v1";

export class DeviceCheckError extends Error {
  constructor() {
    super("DeviceCheck verification failed.");
    this.name = "DeviceCheckError";
  }
}

export type DeviceCheckClient = {
  isOnboardingPreviewUsed(deviceToken: string): Promise<boolean>;
  markOnboardingPreviewUsed(deviceToken: string): Promise<void>;
};

function base64Url(value: Uint8Array | string) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function pemToBytes(value: string) {
  const body = value
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  if (!body) throw new DeviceCheckError();
  try {
    const binary = atob(body);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new DeviceCheckError();
  }
}

async function createAppleJwt({
  keyId,
  privateKey,
  teamId,
}: {
  keyId: string;
  privateKey: string;
  teamId: string;
}) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const protectedHeader = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64Url(
    JSON.stringify({ iss: teamId, iat: issuedAt, exp: issuedAt + 300 }),
  );
  const signingInput = `${protectedHeader}.${payload}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new DeviceCheckError();
  }
  try {
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        new TextEncoder().encode(signingInput),
      ),
    );
    return `${signingInput}.${base64Url(signature)}`;
  } catch {
    throw new DeviceCheckError();
  }
}

export function createAppleDeviceCheckClient({
  environment,
  fetchImpl = fetch,
  keyId,
  privateKey,
  teamId,
}: {
  environment: "development" | "production";
  fetchImpl?: typeof fetch;
  keyId: string;
  privateKey: string;
  teamId: string;
}): DeviceCheckClient {
  const baseUrl =
    environment === "production"
      ? APPLE_DEVICECHECK_PRODUCTION_URL
      : APPLE_DEVICECHECK_DEVELOPMENT_URL;
  if (!keyId || !privateKey || !teamId) throw new DeviceCheckError();

  const request = async (path: string, body: Record<string, unknown>) => {
    const token = await createAppleJwt({ keyId, privateKey, teamId });
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          timestamp: Date.now(),
          transaction_id: crypto.randomUUID(),
        }),
      });
    } catch {
      throw new DeviceCheckError();
    }
    if (!response.ok) throw new DeviceCheckError();
    return response;
  };

  return {
    async isOnboardingPreviewUsed(deviceToken) {
      const response = await request("query_two_bits", {
        device_token: deviceToken,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new DeviceCheckError();
      }
      const bit = (payload as { bit0?: unknown } | null)?.bit0;
      if (typeof bit !== "boolean") throw new DeviceCheckError();
      return bit;
    },
    async markOnboardingPreviewUsed(deviceToken) {
      await request("update_two_bits", {
        bit0: true,
        device_token: deviceToken,
      });
    },
  };
}
