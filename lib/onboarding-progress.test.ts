import assert from "node:assert/strict";
import test from "node:test";
import {
  hasDisplayedOnboardingReply,
  markOnboardingReplyDisplayed,
  ONBOARDING_REPLY_DISPLAYED_KEY,
  type OnboardingProgressStorage,
} from "./onboarding-progress";

function storageWith(value: string | null = null) {
  const values = new Map<string, string>();
  if (value) values.set(ONBOARDING_REPLY_DISPLAYED_KEY, value);
  const storage: OnboardingProgressStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, nextValue) => {
      values.set(key, nextValue);
    },
  };
  return { storage, values };
}

test("onboarding reply progress is absent until a displayed reply is marked", async () => {
  const { storage, values } = storageWith();
  assert.equal(await hasDisplayedOnboardingReply(storage), false);
  await markOnboardingReplyDisplayed(storage);
  assert.equal(values.get(ONBOARDING_REPLY_DISPLAYED_KEY), "true");
  assert.equal(await hasDisplayedOnboardingReply(storage), true);
});

test("only the expected marker resumes the onboarding reply step", async () => {
  assert.equal(
    await hasDisplayedOnboardingReply(storageWith("false").storage),
    false,
  );
  assert.equal(
    await hasDisplayedOnboardingReply(storageWith("true").storage),
    true,
  );
});
