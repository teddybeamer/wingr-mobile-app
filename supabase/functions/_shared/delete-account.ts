import { handleCors } from "./cors.ts";
import { json } from "./http.ts";

type VerifiedUser = {
  id: string;
  isAnonymous: boolean;
};

export type AccountDeletionDependencies = {
  /** Verifies signature, expiry and issuer before returning the JWT subject. */
  getVerifiedSubject(accessToken: string): Promise<string | null>;
  /** Returns null only after confirming the verified subject no longer exists. */
  getAuthenticatedUser(
    accessToken: string,
    subject: string,
  ): Promise<VerifiedUser | null>;
  /** Deletes the verified Auth user, or succeeds when a concurrent delete won. */
  deleteVerifiedUser(subject: string): Promise<void>;
  logFailure?: (code: string) => void;
};

const FAILURE = { code: "account_deletion_failed" };

function failure(status: number, code: string) {
  return json(status === 401 ? { code: "unauthorized" } : FAILURE, { status });
}

async function hasNoRequestBody(request: Request) {
  const body = await request.text();
  return body.trim().length === 0;
}

/**
 * Deletes the caller's anonymous Auth account. This function never reads a user
 * ID from the request, and its dependency boundary keeps all raw Auth errors out
 * of responses and logs.
 */
export async function handleDeleteAccountRequest(
  request: Request,
  dependencies: AccountDeletionDependencies,
) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  if (request.method !== "POST") return failure(405, "method_not_allowed");

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return failure(401, "missing_bearer");
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) return failure(401, "missing_token");

  try {
    if (!(await hasNoRequestBody(request))) return failure(400, "unexpected_body");

    const subject = await dependencies.getVerifiedSubject(accessToken);
    if (!subject) return failure(401, "invalid_token");

    const user = await dependencies.getAuthenticatedUser(accessToken, subject);
    // A signed, unexpired JWT can outlive a completed deletion. The dependency
    // returns null only after an admin lookup confirms this exact subject is gone.
    if (!user) return json({ deleted: true });
    if (user.id !== subject || !user.isAnonymous)
      return failure(403, "not_anonymous_caller");

    await dependencies.deleteVerifiedUser(user.id);
    return json({ deleted: true });
  } catch {
    dependencies.logFailure?.("account_deletion_failed");
    return failure(500, "account_deletion_failed");
  }
}
