import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { createRequestAuthentication } from "./supabase-auth";
import { postJsonToWingrBackend } from "./wingr-api";

function harness(error: Error | null = null, duringRefresh = false, signupError: Error | null = null) {
  const calls = { read: 0, refresh: 0, clear: 0, signup: 0 };
  let stored: { access_token: string; expires_at: number } | null = {
    access_token: "existing-token", expires_at: duringRefresh ? 1 : Date.now() / 1000 + 3600,
  };
  const auth = {
    async getSession() {
      calls.read++;
      return { data: { session: stored }, error: duringRefresh ? null : error };
    },
    async refreshSession() {
      calls.refresh++;
      return { data: { session: null }, error };
    },
    async signInAnonymously() {
      calls.signup++;
      assert.equal(stored, null, "invalid persisted session cleared before signup");
      stored = { access_token: "new-token", expires_at: Date.now() / 1000 + 3600 };
      return { data: { session: stored }, error: signupError };
    },
  };
  const getClient = () => ({ client: { auth }, configuration: { url: "https://wingr.supabase.co", publishableKey: "public-key" } });
  const authenticate = createRequestAuthentication(
    getClient as Parameters<typeof createRequestAuthentication>[0],
    async () => { calls.clear++; stored = null; error = null; },
  );
  return { authenticate, calls };
}

test("valid persisted session is reused without refresh or signup", async () => {
  const { authenticate, calls } = harness();
  assert.equal((await authenticate()).accessToken, "existing-token");
  assert.deepEqual(calls, { read: 1, refresh: 0, clear: 0, signup: 0 });
});

test("invalid refresh token during session loading or explicit refresh recovers once", async () => {
  for (const duringRefresh of [false, true]) {
    for (const code of [undefined, "refresh_token_not_found", "refresh_token_already_used"]) {
      const { authenticate, calls } = harness(new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, code), duringRefresh);
      assert.equal((await authenticate()).accessToken, "new-token");
      assert.equal(calls.clear, 1);
      assert.equal(calls.signup, 1);
      assert.equal((await authenticate()).accessToken, "new-token");
      assert.equal(calls.signup, 1);
    }
  }
});

test("unrelated authentication, network and server errors propagate without signup", async () => {
  for (const error of [
    new AuthApiError("Anonymous sign-ins disabled", 400, "anonymous_provider_disabled"),
    new AuthRetryableFetchError("Network failure", 0),
    new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 500, undefined),
    new Error("Invalid Refresh Token: Refresh Token Not Found"),
  ]) {
    for (const duringRefresh of [false, true]) {
      const { authenticate, calls } = harness(error, duringRefresh);
      await assert.rejects(authenticate(), (failure) => failure === error);
      assert.equal(calls.clear, 0);
      assert.equal(calls.signup, 0);
    }
  }
});

test("concurrent callers share the same recovery and new session", async () => {
  const { authenticate, calls } = harness(new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, undefined));
  const first = authenticate();
  assert.equal(authenticate(), first);
  const results = await Promise.all([first, ...Array.from({ length: 10 }, authenticate)]);
  assert.ok(results.every((result) => result.accessToken === "new-token"));
  assert.deepEqual(calls, { read: 1, refresh: 0, clear: 1, signup: 1 });
});

test("failed replacement signup terminates without another recovery", async () => {
  const failure = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, undefined);
  const { authenticate, calls } = harness(failure, false, failure);
  await assert.rejects(authenticate(), (error) => error === failure);
  assert.equal(calls.clear, 1);
  assert.equal(calls.signup, 1);
});

test("original AI request proceeds once using recovered access token", async (t) => {
  const previous = process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
  process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = "https://wingr.example";
  t.after(() => {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WINGR_API_BASE_URL;
    else process.env.EXPO_PUBLIC_WINGR_API_BASE_URL = previous;
  });
  const { authenticate, calls } = harness(new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, undefined));
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer new-token");
    return Response.json({ success: true });
  });
  assert.deepEqual(await postJsonToWingrBackend("/ai-conversation", {}, undefined, authenticate), { success: true });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(calls.signup, 1);
});
