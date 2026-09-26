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

export type DeviceCheckResponseClassification =
  | "bits_json"
  | "bit_state_not_found"
  | "apple_4xx"
  | "apple_5xx"
  | "network"
  | "unexpected_response";

export type DeviceCheckDiagnostic = {
  classification: DeviceCheckResponseClassification;
  contentType: string | null;
  status: number | null;
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
  onDiagnostic = (diagnostic: DeviceCheckDiagnostic) =>
    console.warn("[Wingr DeviceCheck] response", diagnostic),
  privateKey,
  teamId,
}: {
  environment: "development" | "production";
  fetchImpl?: typeof fetch;
  keyId: string;
  onDiagnostic?: (diagnostic: DeviceCheckDiagnostic) => void;
  privateKey: string;
  teamId: string;
}): DeviceCheckClient {
  const baseUrl =
    environment === "production"
      ? APPLE_DEVICECHECK_PRODUCTION_URL
      : APPLE_DEVICECHECK_DEVELOPMENT_URL;
  if (!keyId || !privateKey || !teamId) throw new DeviceCheckError();

  // Diagnostics must never affect the DeviceCheck decision or expose Apple
  // response bodies, request data, or credentials.
  const diagnose = (diagnostic: DeviceCheckDiagnostic) => {
    try {
      onDiagnostic(diagnostic);
    } catch {
      // Logging is strictly best-effort.
    }
  };
  const responseMetadata = (response: Response) => ({
    contentType: response.headers.get("content-type"),
    status: response.status,
  });
  const responseFailureClassification = (
    status: number,
  ): DeviceCheckResponseClassification => {
    if (status >= 400 && status < 500) return "apple_4xx";
    if (status >= 500 && status < 600) return "apple_5xx";
    return "unexpected_response";
  };
  const isBitStateNotFound = (body: string) => {
    const normalized = body.trim().toLowerCase();
    return (
      normalized === "bit state not found" ||
      normalized === "failed to find bit state"
    );
  };

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
      diagnose({
        classification: "network",
        contentType: null,
        status: null,
      });
      throw new DeviceCheckError();
    }
    if (!response.ok) {
      diagnose({
        ...responseMetadata(response),
        classification: responseFailureClassification(response.status),
      });
      throw new DeviceCheckError();
    }
    return response;
  };

  return {
    async isOnboardingPreviewUsed(deviceToken) {
      const response = await request("query_two_bits", {
        device_token: deviceToken,
      });
      const metadata = responseMetadata(response);
      let body: string;
      try {
        body = await response.text();
      } catch {
        diagnose({ ...metadata, classification: "network" });
        throw new DeviceCheckError();
      }
      if (isBitStateNotFound(body)) {
        diagnose({ ...metadata, classification: "bit_state_not_found" });
        // Apple has no bit record until the first update. Treat that as both
        // bits being false; this method only needs bit0's used state.
        return false;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        diagnose({ ...metadata, classification: "unexpected_response" });
        throw new DeviceCheckError();
      }
      const bit = (payload as { bit0?: unknown } | null)?.bit0;
      if (typeof bit !== "boolean") {
        diagnose({ ...metadata, classification: "unexpected_response" });
        throw new DeviceCheckError();
      }
      diagnose({ ...metadata, classification: "bits_json" });
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
