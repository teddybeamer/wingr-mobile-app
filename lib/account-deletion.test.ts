import assert from "node:assert/strict";
import test from "node:test";
import { AccountDeletionError, deleteWingrAccount } from "./account-deletion";

const authentication = async () => ({
  accessToken: "caller-token",
  publishableKey: "publishable-key",
  userId: "caller-id",
});

test("account deletion sends only authenticated standard headers and no user ID/body", async (t) => {
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async (url: string, init: RequestInit) => {
      assert.equal(url, "https://wingr.example/functions/v1/delete-account");
      assert.equal(init.method, "POST");
      assert.equal(init.body, undefined);
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer caller-token");
      assert.equal(headers.get("apikey"), "publishable-key");
      assert.equal(headers.get("content-type"), null);
      return Response.json({ deleted: true });
    },
  );
  await deleteWingrAccount({
    baseUrl: "https://wingr.example/functions/v1",
    getAuthentication: authentication,
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("a deletion failure does not perform a second request or expose backend text", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "private backend detail" }, { status: 500 }),
  );
  await assert.rejects(
    deleteWingrAccount({
      baseUrl: "https://wingr.example/functions/v1",
      getAuthentication: authentication,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AccountDeletionError);
      assert.ok(!error.message.includes("private backend detail"));
      return true;
    },
  );
  assert.equal(fetch.mock.callCount(), 1);
});
