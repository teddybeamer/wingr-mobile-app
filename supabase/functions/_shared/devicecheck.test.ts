import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createAppleDeviceCheckClient,
  DeviceCheckError,
  type DeviceCheckDiagnostic,
} from "./devicecheck.ts";

const DEVICE_TOKEN = "ZmFrZS1kZXZpY2UtY2hlY2stdG9rZW4=";
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();

function clientFor(
  fetchImpl: typeof fetch,
  diagnostics: DeviceCheckDiagnostic[],
) {
  return createAppleDeviceCheckClient({
    environment: "development",
    fetchImpl,
    keyId: "ABCDEFGHIJ",
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    privateKey: PRIVATE_KEY,
    teamId: "746YAZ4TPQ",
  });
}

test("treats Apple's HTTP 200 bit-state-not-found response as an unused device without logging its body", async () => {
  const diagnostics: DeviceCheckDiagnostic[] = [];
  const responseBody = "Bit State Not Found";
  const client = clientFor(
    async () =>
      new Response(responseBody, {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
      }),
    diagnostics,
  );

  assert.equal(await client.isOnboardingPreviewUsed(DEVICE_TOKEN), false);
  assert.deepEqual(diagnostics, [
    {
      classification: "bit_state_not_found",
      contentType: "application/json; charset=UTF-8",
      status: 200,
    },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes(responseBody), false);
});

test("classifies a valid Apple bit response", async () => {
  const diagnostics: DeviceCheckDiagnostic[] = [];
  const client = clientFor(
    async () =>
      Response.json({ bit0: true, bit1: false, last_update_time: "2026-09" }),
    diagnostics,
  );

  assert.equal(await client.isOnboardingPreviewUsed(DEVICE_TOKEN), true);
  assert.deepEqual(diagnostics, [
    {
      classification: "bits_json",
      contentType: "application/json",
      status: 200,
    },
  ]);
});

test("marks a successful onboarding generation by setting bit0", async () => {
  const diagnostics: DeviceCheckDiagnostic[] = [];
  let request: Request | undefined;
  const client = clientFor(async (input, init) => {
    request = new Request(input, init);
    return new Response(null, { status: 200 });
  }, diagnostics);

  await client.markOnboardingPreviewUsed(DEVICE_TOKEN);

  assert.equal(request?.url.endsWith("/update_two_bits"), true);
  assert.ok(request);
  const body = (await request.json()) as Record<string, unknown>;
  assert.equal(body.bit0, true);
  assert.equal(body.device_token, DEVICE_TOKEN);
  assert.equal(typeof body.timestamp, "number");
  assert.equal(typeof body.transaction_id, "string");
  assert.deepEqual(diagnostics, []);
});

test("classifies Apple 4xx and 5xx responses without reading their bodies", async () => {
  for (const [status, classification] of [
    [401, "apple_4xx"],
    [503, "apple_5xx"],
  ] as const) {
    const diagnostics: DeviceCheckDiagnostic[] = [];
    const client = clientFor(
      async () =>
        new Response("not logged", {
          status,
          headers: { "content-type": "text/plain" },
        }),
      diagnostics,
    );

    await assert.rejects(
      () => client.isOnboardingPreviewUsed(DEVICE_TOKEN),
      DeviceCheckError,
    );
    assert.deepEqual(diagnostics, [
      { classification, contentType: "text/plain", status },
    ]);
  }
});

test("classifies fetch failures as network without request details", async () => {
  const diagnostics: DeviceCheckDiagnostic[] = [];
  const client = clientFor(async () => {
    throw new Error("connection reset");
  }, diagnostics);

  await assert.rejects(
    () => client.isOnboardingPreviewUsed(DEVICE_TOKEN),
    DeviceCheckError,
  );
  assert.deepEqual(diagnostics, [
    { classification: "network", contentType: null, status: null },
  ]);
});

test("classifies successful non-bit responses as unexpected without logging content", async () => {
  const diagnostics: DeviceCheckDiagnostic[] = [];
  const responseBody = JSON.stringify({ bit1: false });
  const client = clientFor(
    async () =>
      new Response(responseBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    diagnostics,
  );

  await assert.rejects(
    () => client.isOnboardingPreviewUsed(DEVICE_TOKEN),
    DeviceCheckError,
  );
  assert.deepEqual(diagnostics, [
    {
      classification: "unexpected_response",
      contentType: "application/json",
      status: 200,
    },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes(responseBody), false);
});
