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

test("consent is asked before the image picker opens, then the picker opens", async () => {
  const order: string[] = [];
  const selected: string[] = [];
  const actions = createOnboardingUploadActions({
    ensureConsent: async () => {
      order.push("consent");
      return true;
    },
    onScreenshotSelected: async (uri) => {
      order.push("selected");
      selected.push(uri);
    },
    onSkip: () => assert.fail("must not skip"),
    pickScreenshot: async () => {
      order.push("picker");
      return "screenshot";
    },
  });

  await actions.chooseScreenshot();
  assert.deepEqual(order, ["consent", "picker", "selected"]);
  assert.deepEqual(selected, ["screenshot"]);
});

test("without consent the picker never opens and nothing is selected or generated", async () => {
  let picks = 0;
  let selections = 0;
  const actions = createOnboardingUploadActions({
    ensureConsent: async () => false,
    onScreenshotSelected: async () => {
      selections++;
    },
    onSkip: () => assert.fail("must not skip"),
    pickScreenshot: async () => {
      picks++;
      return "screenshot";
    },
  });

  await actions.chooseScreenshot();
  assert.equal(picks, 0);
  assert.equal(selections, 0);
});

test("after No, thanks the next Choose Screenshot tap asks again", async () => {
  const answers = [false, true];
  let asked = 0;
  let picks = 0;
  const actions = createOnboardingUploadActions({
    ensureConsent: async () => {
      asked++;
      return answers.shift() ?? false;
    },
    onScreenshotSelected: async () => {},
    onSkip: () => {},
    pickScreenshot: async () => {
      picks++;
      return "screenshot";
    },
  });

  await actions.chooseScreenshot();
  assert.equal(picks, 0);
  await actions.chooseScreenshot();
  assert.equal(asked, 2);
  assert.equal(picks, 1);
});

test("a consent check that throws fails closed: the picker does not open", async () => {
  let picks = 0;
  const actions = createOnboardingUploadActions({
    ensureConsent: async () => {
      throw new Error("offline");
    },
    onSkip: () => {},
    pickScreenshot: async () => {
      picks++;
      return "screenshot";
    },
  });

  await assert.rejects(actions.chooseScreenshot());
  assert.equal(picks, 0);
});
