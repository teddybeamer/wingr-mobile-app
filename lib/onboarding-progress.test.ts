import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOnboardingCompletion,
  hasDisplayedOnboardingReply,
  hasCompletedOnboarding,
  markOnboardingCompleted,
  markOnboardingReplyDisplayed,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_REPLY_DISPLAYED_KEY,
  type OnboardingProgressStorage,
  clearOnboardingReplyProgress,
} from "./onboarding-progress";

function storageWith(value: string | null = null) {
  const values = new Map<string, string>();
  if (value) values.set(ONBOARDING_REPLY_DISPLAYED_KEY, value);
  const storage: OnboardingProgressStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, nextValue) => {
      values.set(key, nextValue);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return { storage, values };
}

test("onboarding reply progress is absent until a displayed reply is marked for that user", async () => {
  const { storage, values } = storageWith();
  assert.equal(await hasDisplayedOnboardingReply("user-a", storage), false);
  await markOnboardingReplyDisplayed("user-a", storage);
  assert.deepEqual(JSON.parse(values.get(ONBOARDING_REPLY_DISPLAYED_KEY)!), {
    userId: "user-a",
  });
  assert.equal(await hasDisplayedOnboardingReply("user-a", storage), true);
  assert.equal(await hasDisplayedOnboardingReply("user-b", storage), false);
});

test("account cleanup removes the onboarding marker", async () => {
  const { storage, values } = storageWith("true");
  await clearOnboardingReplyProgress(storage);
  assert.equal(values.has(ONBOARDING_REPLY_DISPLAYED_KEY), false);
});

test("only the expected marker resumes the onboarding reply step", async () => {
  assert.equal(
    await hasDisplayedOnboardingReply(
      "user-a",
      storageWith(JSON.stringify({ userId: "user-b" })).storage,
    ),
    false,
  );
  assert.equal(
    await hasDisplayedOnboardingReply(
      "user-a",
      storageWith(JSON.stringify({ userId: "user-a" })).storage,
    ),
    true,
  );
});

test("onboarding completion is persisted per account and cleared with local account state", async () => {
  const { storage, values } = storageWith();
  await markOnboardingCompleted("user-a", storage);
  assert.equal(await hasCompletedOnboarding("user-a", storage), true);
  assert.equal(await hasCompletedOnboarding("user-b", storage), false);
  await clearOnboardingCompletion(storage);
  assert.equal(values.has(ONBOARDING_COMPLETED_KEY), false);
});
