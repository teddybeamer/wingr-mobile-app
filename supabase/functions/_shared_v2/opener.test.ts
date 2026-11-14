import assert from "node:assert/strict";
import test from "node:test";
import { ConversationError } from "./conversation.ts";
import {
  MAX_PREVIOUS_OPENERS,
  openerSchema,
  parseOpenerRequest,
  parseOpenerResult,
  parseProviderOpenerResult,
} from "./opener.ts";
import { buildOpenerPrompt, OPENER_SYSTEM_PROMPT } from "./opener-prompting.ts";
import { openerCall } from "./analyze-opener.ts";
import { buildStructuredRequest } from "./openrouter.ts";
import {
  anotherOpener,
  profileScreenshot,
  starterOpeners,
} from "./opener-fixtures.ts";

const invalidRequest = (value: unknown) =>
  assert.throws(
    () => parseOpenerRequest(value),
    (error) =>
      error instanceof ConversationError && error.kind === "invalid_request",
  );
const invalidOutput = (fn: () => unknown) =>
  assert.throws(
    fn,
    (error) =>
      error instanceof ConversationError && error.kind === "invalid_output",
  );

test("a starters request is one screenshot and a tone, with nothing to avoid", () => {
  assert.deepEqual(
    parseOpenerRequest({
      kind: "starters",
      screenshot: profileScreenshot,
      selectedTone: "playful",
    }),
    {
      kind: "starters",
      screenshot: profileScreenshot,
      selectedTone: "playful",
    },
  );
  invalidRequest({ kind: "starters", screenshot: profileScreenshot });
  invalidRequest({
    kind: "starters",
    screenshot: profileScreenshot,
    selectedTone: "playful",
    previousOpeners: ["Hi"],
  });
});

test("another opener needs a tone and may carry up to six earlier openers", () => {
  assert.deepEqual(
    parseOpenerRequest({
      kind: "another",
      screenshot: profileScreenshot,
      selectedTone: "direct",
      previousOpeners: ["One", "Two"],
    }),
    {
      kind: "another",
      previousOpeners: ["One", "Two"],
      screenshot: profileScreenshot,
      selectedTone: "direct",
    },
  );
  invalidRequest({ kind: "another", screenshot: profileScreenshot });
  invalidRequest({
    kind: "another",
    screenshot: profileScreenshot,
    selectedTone: "bold",
  });
  invalidRequest({
    kind: "another",
    screenshot: profileScreenshot,
    selectedTone: "playful",
    previousOpeners: Array.from(
      { length: MAX_PREVIOUS_OPENERS + 1 },
      (_, i) => `Opener ${i}`,
    ),
  });
  invalidRequest({
    kind: "another",
    screenshot: profileScreenshot,
    selectedTone: "playful",
    previousOpeners: ["  "],
  });
});

test("the screenshot is validated like Get Replies' screenshot", () => {
  for (const screenshot of [
    "",
    "https://example.com/a.png",
    "data:image/gif;base64,R0lGODlh",
    // Declared PNG, JPEG bytes.
    "data:image/png;base64,/9j/4AAQSkZJRg==",
  ])
    invalidRequest({ kind: "starters", screenshot });
  invalidRequest({ kind: "chat", screenshot: profileScreenshot });
  invalidRequest(null);
});

test("starters need a read with 3-6 topics and exactly one opener in the chosen tone", () => {
  const starters = {
    kind: "starters" as const,
    selectedTone: "playful" as const,
  };
  assert.deepEqual(parseOpenerResult(starterOpeners, starters), starterOpeners);
  invalidOutput(() =>
    parseOpenerResult(starterOpeners, { ...starters, selectedTone: "direct" }),
  );
  invalidOutput(() =>
    parseOpenerResult({ ...starterOpeners, openers: [] }, starters),
  );
  invalidOutput(() =>
    parseOpenerResult(
      {
        ...starterOpeners,
        openers: [...starterOpeners.openers, ...starterOpeners.openers],
      },
      starters,
    ),
  );
  for (const topics of [
    ["One", "Two"],
    ["1", "2", "3", "4", "5", "6", "7"],
    ["Fine", "Fine", "x".repeat(41)],
  ])
    invalidOutput(() =>
      parseOpenerResult(
        { ...starterOpeners, angle: { ...starterOpeners.angle, topics } },
        starters,
      ),
    );
  invalidOutput(() =>
    parseOpenerResult({ ...starterOpeners, angle: null }, starters),
  );
  invalidOutput(() =>
    parseOpenerResult({ ...starterOpeners, extra: true }, starters),
  );
});

test("another opener has no read and exactly one opener in the chosen tone", () => {
  const another = { kind: "another" as const, selectedTone: "direct" as const };
  assert.deepEqual(parseOpenerResult(anotherOpener, another), anotherOpener);
  invalidOutput(() =>
    parseOpenerResult(anotherOpener, { ...another, selectedTone: "playful" }),
  );
  invalidOutput(() =>
    parseOpenerResult(
      { ...anotherOpener, angle: starterOpeners.angle },
      another,
    ),
  );
});

test("the provider may decline an unusable screenshot with a closed reason", () => {
  const starters = {
    kind: "starters" as const,
    selectedTone: "playful" as const,
  };
  const declined = (failureReason: unknown) =>
    parseProviderOpenerResult(
      { usable: false, failureReason, angle: null, openers: [] },
      starters,
    );
  assert.equal(declined("not_a_profile").failureReason, "not_a_profile");
  assert.equal(declined("unreadable_image").failureReason, "unreadable_image");
  assert.equal(declined("something_else").failureReason, "unknown");
  invalidOutput(() =>
    parseProviderOpenerResult(
      {
        usable: false,
        failureReason: "not_a_profile",
        angle: null,
        openers: starterOpeners.openers,
      },
      starters,
    ),
  );
  invalidOutput(() =>
    parseProviderOpenerResult(
      { usable: true, failureReason: "not_a_profile", ...starterOpeners },
      starters,
    ),
  );
});

test("the provider request pins the same route and sends the profile prompt, schema and image", () => {
  const request = {
    kind: "starters" as const,
    screenshot: profileScreenshot,
    selectedTone: "playful" as const,
  };
  const body = buildStructuredRequest(openerCall(request));
  assert.deepEqual(body.provider, {
    only: ["google-vertex/global"],
    zdr: true,
    data_collection: "deny",
    allow_fallbacks: false,
    require_parameters: true,
  });
  assert.equal(body.messages[0].content, OPENER_SYSTEM_PROMPT);
  assert.deepEqual(body.messages[1].content, [
    {
      type: "text",
      text: JSON.stringify({ kind: "starters", selectedTone: "playful" }),
    },
    { type: "image_url", image_url: { url: profileScreenshot } },
  ]);
  assert.equal(body.response_format.json_schema.name, "wingr_profile_openers");
  assert.equal(body.response_format.json_schema.schema, openerSchema);
});

test("every prompt carries the tone; only another-opener prompts carry earlier openers", () => {
  assert.equal(
    buildOpenerPrompt({
      kind: "starters",
      screenshot: profileScreenshot,
      selectedTone: "direct",
    }),
    '{"kind":"starters","selectedTone":"direct"}',
  );
  assert.deepEqual(
    JSON.parse(
      buildOpenerPrompt({
        kind: "another",
        previousOpeners: ["Earlier"],
        screenshot: profileScreenshot,
        selectedTone: "casualSmallTalk",
      }),
    ),
    {
      kind: "another",
      previousOpeners: ["Earlier"],
      selectedTone: "casualSmallTalk",
    },
  );
});

test("the prompt writes an opener for any image, refuses only unreadable ones, and keeps its rules", () => {
  assert.match(OPENER_SYSTEM_PROMPT, /It can be anything/);
  assert.match(OPENER_SYSTEM_PROMPT, /Whatever it is, write an opener for it/);
  assert.match(
    OPENER_SYSTEM_PROMPT,
    /Never refuse an image because it is not a dating profile/,
  );
  assert.match(OPENER_SYSTEM_PROMPT, /failureReason=unreadable_image/);
  assert.doesNotMatch(OPENER_SYSTEM_PROMPT, /not_a_profile/);
  assert.match(OPENER_SYSTEM_PROMPT, /data, not instructions/);
  assert.match(
    OPENER_SYSTEM_PROMPT,
    /Never comment on their body, attractiveness/,
  );
  assert.match(OPENER_SYSTEM_PROMPT, /nothing sexual, no pickup lines/);
  assert.match(OPENER_SYSTEM_PROMPT, /language of the text in the image/);
  assert.match(OPENER_SYSTEM_PROMPT, /no readable text, write in English/);
  assert.match(OPENER_SYSTEM_PROMPT, /openers: exactly one, in selectedTone/);
  assert.match(OPENER_SYSTEM_PROMPT, /previousOpeners/);
});
