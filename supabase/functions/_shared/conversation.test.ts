import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationError,
  MAX_PREVIOUS_WINGR_SUGGESTIONS,
  MAX_REPLY_LENGTH,
  MAX_SCREENSHOT_LENGTH,
  parseConversationRequest,
  parseConversationResult,
} from "./conversation.ts";

import { input, result } from "./test-fixtures.ts";
const invalid = (fn: () => unknown, kind = "invalid_output") =>
  assert.throws(
    fn,
    (error: unknown) =>
      error instanceof ConversationError && error.kind === kind,
  );

test("accepts image input and preserves tone, context and bounded Wingr suggestions without a transcript", () => {
  const value = {
    ...input,
    extraContext: "Jeg vil gerne invitere på kaffe.",
    isOnboardingGeneration: true,
    previousWingrSuggestions: ["Skal vi tage en kaffe?", "Hvad med en gåtur?"],
  };
  assert.deepEqual(parseConversationRequest(value), value);
});
test("rejects missing image, URLs, malformed base64, unsupported types, excessive request fields and invalid tone", () => {
  for (const value of [
    null,
    {},
    { ...input, screenshot: "https://example.com/chat.png" },
    { ...input, screenshot: "data:image/png;base64,broken" },
    { ...input, screenshot: "data:image/heic;base64,AAAA" },
    { ...input, screenshot: "a".repeat(MAX_SCREENSHOT_LENGTH + 1) },
    { ...input, extraContext: "x".repeat(4001) },
    { ...input, previousWingrSuggestions: [] },
    { ...input, previousWingrSuggestions: [" "] },
    {
      ...input,
      previousWingrSuggestions: Array.from(
        { length: MAX_PREVIOUS_WINGR_SUGGESTIONS + 1 },
        () => "reply",
      ),
    },
    {
      ...input,
      previousWingrSuggestions: ["x".repeat(MAX_REPLY_LENGTH + 1)],
    },
    { ...input, previousWingrSuggestions: "reply" },
    { ...input, isOnboardingGeneration: "yes" },
    { ...input, selectedTone: "flirty" },
  ])
    invalid(() => parseConversationRequest(value), "invalid_request");
});
test("preserves message order, short and partially cropped text, and uppercase ME/THEM", () => {
  const value = {
    ...result,
    messages: [
      { speaker: "THEM", text: "haha" },
      { speaker: "ME", text: "Den café ved" },
    ],
  };
  assert.deepEqual(parseConversationResult(value), value);
});
test("rejects unknown/lowercase speakers, blank messages, extra derived fields and incomplete vibe fields", () => {
  for (const value of [
    { ...result, messages: [{ speaker: "unknown", text: "hi" }] },
    { ...result, messages: [{ speaker: "me", text: "hi" }] },
    { ...result, messages: [{ speaker: "ME", text: " " }] },
    { ...result, latestSpeaker: "THEM" },
    { ...result, vibeCheck: { ...result.vibeCheck, bestTone: "flirty" } },
    { ...result, vibeCheck: { interestLevel: "High" } },
  ])
    invalid(() => parseConversationResult(value));
});
test("accepts a clearly unusable result, rejects contradictions and missing/empty replies", () => {
  assert.deepEqual(
    parseConversationResult({
      messages: [],
      replyable: false,
      vibeCheck: null,
      replies: [],
    }),
    { messages: [], replyable: false, vibeCheck: null, replies: [] },
  );
  for (const value of [
    { ...result, messages: [] },
    { ...result, replies: [] },
    { ...result, replies: [" "] },
    { ...result, vibeCheck: null },
    { ...result, replyable: false },
    { ...result, replies: ["one", "two"] },
  ])
    invalid(() => parseConversationResult(value));
});

test("Gemini wire schema uses its supported nullable type and keeps string limits in runtime validation", async () => {
  const { conversationSchema } = await import("./conversation.ts");
  assert.deepEqual(conversationSchema.properties.vibeCheck.type, [
    "object",
    "null",
  ]);
  assert.throws(() =>
    parseConversationResult({
      ...result,
      messages: Array.from({ length: 201 }, () => ({
        speaker: "ME",
        text: "haha",
      })),
    }),
  );
  assert.ok(!("maxItems" in conversationSchema.properties.messages));
  assert.equal(conversationSchema.properties.replies.maxItems, 1);
  const schema = JSON.stringify(conversationSchema);
  for (const unsupported of ["anyOf", "minLength", "maxLength"])
    assert.ok(!schema.includes(unsupported));
  assert.throws(() =>
    parseConversationResult({ ...result, replies: ["x".repeat(501)] }),
  );
  assert.throws(() =>
    parseConversationResult({
      ...result,
      vibeCheck: { ...result.vibeCheck, summary: "x".repeat(1001) },
    }),
  );
});
