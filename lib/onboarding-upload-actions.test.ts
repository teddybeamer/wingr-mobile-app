import assert from "node:assert/strict";
import test from "node:test";
import { createOnboardingUploadActions } from "../onboarding/upload-actions";

test("Skip advances without choosing a screenshot or invoking generation", () => {
  let screenshotPicks = 0;
  let generations = 0;
  let skips = 0;
  const actions = createOnboardingUploadActions({
    onScreenshotSelected: async () => {
      generations++;
    },
    onSkip: () => {
      skips++;
    },
    pickScreenshot: async () => {
      screenshotPicks++;
      return "screenshot";
    },
  });

  actions.skip();

  assert.equal(skips, 1);
  assert.equal(screenshotPicks, 0);
  assert.equal(generations, 0);
});

test("Choose Screenshot preserves the existing selection and generation path", async () => {
  const selected: string[] = [];
  const actions = createOnboardingUploadActions({
    onScreenshotSelected: async (uri) => {
      selected.push(uri);
    },
    onSkip: () => assert.fail("must not skip"),
    pickScreenshot: async () => "screenshot",
  });

  await actions.chooseScreenshot();
  assert.deepEqual(selected, ["screenshot"]);
});
