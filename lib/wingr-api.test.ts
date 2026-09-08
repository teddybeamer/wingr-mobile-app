import assert from "node:assert/strict";
import test from "node:test";
import { postJsonToWingrBackend } from "./wingr-api";
import { input, result } from "../supabase/functions/_shared/test-fixtures";

const authentication = async () => ({
  accessToken: "user-token",
  publishableKey: "publishable-key",
});

test("app posts the image and selected tone to the sole endpoint once", async (t) => {
  const previous = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  process.env.EXPO_PUBLIC_WINGR_API_BASE_URL =
    "https://wingr.example/functions/v1/";
  t.after(() => {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
    else process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = previous;
  });
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      assert.equal(url, "https://wingr.example/functions/v1/ai-conversation");
      assert.deepEqual(JSON.parse(String(init.body)), input);
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer user-token");
      assert.equal(new Headers(init.headers).get("apikey"), "publishable-key");
      assert.ok(init.signal);
      return Response.json(result);
    },
  );
  assert.deepEqual(
    await postJsonToWingrBackend("/ai-conversation", input, undefined, authentication),
    result,
  );
  assert.equal(mock.mock.callCount(), 1);
});
test("app fails closed without a configured backend, with no mock replies", async (t) => {
  const previous = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  t.after(() => {
    if (previous !== undefined)
      process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = previous;
  });
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected fetch");
  });
  await assert.rejects(
    postJsonToWingrBackend("/ai-conversation", input),
    /not configured/,
  );
  assert.equal(mock.mock.callCount(), 0);
});
test("app timeout includes stalled body reads and never starts a second request", async (t) => {
  const previous = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = "https://wingr.example";
  t.after(() => {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
    else process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = previous;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const response = new Response();
      response.json = () =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        );
      return response;
    },
  );
  const pending = postJsonToWingrBackend(
    "/ai-conversation",
    input,
    undefined,
    authentication,
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  const rejection = assert.rejects(pending, /took too long/);
  t.mock.timers.tick(35_000);
  await rejection;
  assert.equal(mock.mock.callCount(), 1);
});

test("app preserves safe backend error codes and provider status without displaying response text", async (t) => {
  const previous = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = "https://wingr.example";
  t.after(() => {
    if (previous === undefined)
      delete process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
    else process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = previous;
  });
  const responses = [
    { code: "provider", providerStatus: 402, error: "PRIVATE CHAT" },
    { code: "invalid_output", error: "PRIVATE CHAT" },
    {
      code: "PRIVATE CHAT",
      providerStatus: "PRIVATE CHAT",
      error: "PRIVATE CHAT",
    },
    { code: "provider", providerStatus: "PRIVATE CHAT", error: "PRIVATE CHAT" },
  ];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(responses.shift(), { status: 502 }),
  );
  for (const expected of [
    /insufficient credits.*OpenRouter 402/,
    /reliable reply/,
    /could not analyze/,
    /could not analyze/,
  ]) {
    await assert.rejects(
      postJsonToWingrBackend(
        "/ai-conversation",
        input,
        undefined,
        authentication,
      ),
      (failure: unknown) => {
        assert.ok(failure instanceof Error);
        assert.match(failure.message, expected);
        assert.ok(!failure.message.includes("PRIVATE"));
        return true;
      },
    );
  }
});
