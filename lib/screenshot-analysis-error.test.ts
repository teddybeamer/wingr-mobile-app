import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeferredScreenshotPicker,
  chooseSemanticReplacement,
  getScreenshotErrorPresentation,
  getSemanticScreenshotError,
} from "./screenshot-analysis-error";

test("semantic reasons map to the approved popup copy", () => {
  assert.deepEqual(getScreenshotErrorPresentation("unreadable_image"), {
    button: "Choose another screenshot",
    message:
      "The messages aren’t clear enough to read. Try a sharper screenshot.",
    title: "Can’t read screenshot",
  });
  assert.deepEqual(getScreenshotErrorPresentation("no_conversation"), {
    button: "Choose another screenshot",
    message:
      "We couldn’t find readable chat messages in this image. Try a screenshot showing your conversation.",
    title: "No readable conversation found",
  });
  const context = {
    button: "Choose another screenshot",
    message:
      "Try a screenshot that shows the latest messages in your conversation.",
    title: "Need a bit more context",
  } as const;
  assert.deepEqual(
    getScreenshotErrorPresentation("ownership_unclear"),
    context,
  );
  assert.deepEqual(
    getScreenshotErrorPresentation("no_replyable_message"),
    context,
  );
  assert.deepEqual(getScreenshotErrorPresentation("unknown"), {
    button: "Choose another screenshot",
    message: "We couldn’t read that conversation. Try another screenshot.",
    title: "Couldn’t analyze screenshot",
  });
});

test("semantic replacement preserves tone and changes flow only after selection", async () => {
  const options: unknown[] = [];
  const selected: string[] = [];
  assert.equal(
    await chooseSemanticReplacement({
      pickScreenshot: async (value) => {
        options.push(value);
        return null;
      },
      onSelected: async (uri) => {
        selected.push(uri);
      },
    }),
    false,
  );
  assert.deepEqual(options, [{ preserveTone: true }]);
  assert.equal(selected.length, 0);

  assert.equal(
    await chooseSemanticReplacement({
      pickScreenshot: async (value) => {
        options.push(value);
        return "replacement.png";
      },
      onSelected: async (uri) => {
        selected.push(uri);
      },
    }),
    true,
  );
  assert.deepEqual(options, [{ preserveTone: true }, { preserveTone: true }]);
  assert.deepEqual(selected, ["replacement.png"]);
});

test("only unusable screenshot errors open a semantic popup", () => {
  assert.equal(
    getSemanticScreenshotError({
      id: 1,
      kind: "analysis",
      message: "safe",
      errorCode: "provider",
    }),
    null,
  );
  assert.deepEqual(
    getSemanticScreenshotError({
      id: 2,
      kind: "analysis",
      message: "safe",
      errorCode: "unusable_screenshot",
    }),
    {
      id: 2,
      presentation: getScreenshotErrorPresentation("unknown"),
    },
  );
});

test("picker opening is deferred until dismissal and cancellation sends no action", async () => {
  let selections = 0;
  const coordinator = createDeferredScreenshotPicker(async () => {
    selections++;
  });

  coordinator.cancel();
  await coordinator.sheetClosed();
  assert.equal(selections, 0);

  coordinator.request();
  assert.equal(selections, 0);
  await coordinator.sheetClosed();
  assert.equal(selections, 1);
  await coordinator.sheetClosed();
  assert.equal(selections, 1);

  coordinator.request();
  coordinator.cancel();
  await coordinator.sheetClosed();
  assert.equal(selections, 1);
});
