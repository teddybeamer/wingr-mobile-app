import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverOnboardingReplyUsed,
  resolveOnboardingResumeStep,
} from "./onboarding-recovery";

test("a new user with no local progress or server claim starts normal onboarding", async () => {
  assert.equal(
    await resolveOnboardingResumeStep({
      claimedOnServer: async () => false,
      localResumeStep: async () => null,
      markRecovered: async () => assert.fail("must not repair progress"),
      userId: "user-a",
    }),
    undefined,
  );
});

test("a server claim repairs missing local progress and resumes at Rating", async () => {
  const repaired: string[] = [];
  assert.equal(
    await resolveOnboardingResumeStep({
      claimedOnServer: async () => true,
      localResumeStep: async () => null,
      markRecovered: async (userId) => {
        repaired.push(userId);
      },
      userId: "user-a",
    }),
    "rating",
  );
  assert.deepEqual(repaired, ["user-a"]);
});

test("existing successful-generation progress still resumes at Testimonials", async () => {
  let serverReads = 0;
  assert.equal(
    await resolveOnboardingResumeStep({
      claimedOnServer: async () => {
        serverReads++;
        return true;
      },
      localResumeStep: async () => "testimonials",
      userId: "user-a",
    }),
    "testimonials",
  );
  assert.equal(serverReads, 0);
});

test("an explicit paywall route bypasses onboarding claim reconciliation", async () => {
  let progressReads = 0;
  assert.equal(
    await resolveOnboardingResumeStep({
      claimedOnServer: async () => {
        progressReads++;
        return true;
      },
      initialStepId: "paywall",
      localResumeStep: async () => {
        progressReads++;
        return null;
      },
      userId: "user-a",
    }),
    "paywall",
  );
  assert.equal(progressReads, 0);
});

test("onboarding_reply_used fallback repairs progress and resumes at Rating", async () => {
  const repaired: string[] = [];
  assert.equal(
    await recoverOnboardingReplyUsed({
      errorCode: "onboarding_reply_used",
      markRecovered: async (userId) => {
        repaired.push(userId);
      },
      userId: "user-a",
    }),
    "rating",
  );
  assert.deepEqual(repaired, ["user-a"]);
});

test("ordinary onboarding errors do not trigger claim recovery", async () => {
  assert.equal(
    await recoverOnboardingReplyUsed({
      errorCode: "provider",
      markRecovered: async () => assert.fail("must not repair progress"),
      userId: "user-a",
    }),
    null,
  );
});
