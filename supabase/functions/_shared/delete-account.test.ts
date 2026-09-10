import assert from "node:assert/strict";
import test from "node:test";
import {
  handleDeleteAccountRequest,
  type AccountDeletionDependencies,
} from "./delete-account.ts";

function dependencies(overrides: Partial<AccountDeletionDependencies> = {}) {
  const calls = { claims: [] as string[], users: [] as string[], deletes: [] as string[], logs: [] as string[] };
  return {
    calls,
    dependencies: {
      getVerifiedSubject: async (token: string) => {
        calls.claims.push(token);
        return "00000000-0000-0000-0000-000000000001";
      },
      getAuthenticatedUser: async (_token: string, subject: string) => {
        calls.users.push(subject);
        return { id: subject, isAnonymous: true };
      },
      deleteVerifiedUser: async (subject: string) => {
        calls.deletes.push(subject);
      },
      logFailure: (code: string) => calls.logs.push(code),
      ...overrides,
    } satisfies AccountDeletionDependencies,
  };
}

function request(init: RequestInit = {}) {
  return new Request("https://wingr.example/delete-account", {
    method: "POST",
    headers: { authorization: "Bearer signed-caller", ...init.headers },
    ...init,
  });
}

test("a verified anonymous caller can delete only its verified Auth subject", async () => {
  const { calls, dependencies: handlerDependencies } = dependencies();
  const response = await handleDeleteAccountRequest(request(), handlerDependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(calls, {
    claims: ["signed-caller"],
    users: ["00000000-0000-0000-0000-000000000001"],
    deletes: ["00000000-0000-0000-0000-000000000001"],
    logs: [],
  });
});

test("body user IDs are rejected before any identity or delete operation", async () => {
  const { calls, dependencies: handlerDependencies } = dependencies();
  const response = await handleDeleteAccountRequest(
    request({ body: JSON.stringify({ user_id: "another-user" }) }),
    handlerDependencies,
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "account_deletion_failed" });
  assert.deepEqual(calls, { claims: [], users: [], deletes: [], logs: [] });
});

test("missing, non-bearer and invalid credentials fail before deletion", async () => {
  for (const authorization of [null, "Basic anything"]) {
    const { calls, dependencies: handlerDependencies } = dependencies();
    const response = await handleDeleteAccountRequest(
      request({ headers: authorization ? { authorization } : {} }),
      handlerDependencies,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(calls.deletes, []);
  }
  const { calls, dependencies: handlerDependencies } = dependencies({
    getVerifiedSubject: async () => null,
  });
  const response = await handleDeleteAccountRequest(request(), handlerDependencies);
  assert.equal(response.status, 401);
  assert.deepEqual(calls.deletes, []);
});

test("a cryptographically verified retry succeeds when that exact Auth subject is already absent", async () => {
  const { calls, dependencies: handlerDependencies } = dependencies({
    getAuthenticatedUser: async () => null,
  });
  const response = await handleDeleteAccountRequest(request(), handlerDependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: true });
  assert.deepEqual(calls.deletes, []);
});

test("identity mismatch, non-anonymous callers and unexpected errors cannot delete an account", async () => {
  for (const user of [
    { id: "00000000-0000-0000-0000-000000000999", isAnonymous: true },
    { id: "00000000-0000-0000-0000-000000000001", isAnonymous: false },
  ]) {
    const { calls, dependencies: handlerDependencies } = dependencies({
      getAuthenticatedUser: async () => user,
    });
    const response = await handleDeleteAccountRequest(request(), handlerDependencies);
    assert.equal(response.status, 403);
    assert.deepEqual(calls.deletes, []);
  }

  const rawFailure = new Error("private auth diagnostic");
  const { calls, dependencies: handlerDependencies } = dependencies({
    deleteVerifiedUser: async () => { throw rawFailure; },
  });
  const response = await handleDeleteAccountRequest(request(), handlerDependencies);
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body, JSON.stringify({ code: "account_deletion_failed" }));
  assert.deepEqual(calls.logs, ["account_deletion_failed"]);
  assert.ok(!body.includes("private auth diagnostic"));
});
