import assert from "node:assert/strict";
import test from "node:test";
import {
  ConversationError,
  MAX_IMAGE_BYTES,
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
const imageDataUrl = (type: "png" | "jpeg" | "webp", bytes: Uint8Array) =>
  `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
const pngSignature = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const jpegSignature = Uint8Array.from([0xff, 0xd8, 0xff]);
const webpSignature = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

test("accepts image input and preserves tone, context and bounded Wingr suggestions without a transcript", () => {
  const value = {
    ...input,
    extraContext: "Jeg vil gerne invitere på kaffe.",
    isOnboardingGeneration: true,
    previousWingrSuggestions: ["Skal vi tage en kaffe?", "Hvad med en gåtur?"],
  };
  assert.deepEqual(parseConversationRequest(value), value);
});
test("accepts PNG, JPEG and WebP when declared types match their byte signatures", () => {
  for (const [type, signature] of [
    ["png", pngSignature],
    ["jpeg", jpegSignature],
    ["webp", webpSignature],
  ] as const) {
    const value = { ...input, screenshot: imageDataUrl(type, signature) };
    const parsed = parseConversationRequest(value);
    assert.equal(parsed.screenshot, value.screenshot);
    assert.equal(parsed.selectedTone, value.selectedTone);
  }
});
test("rejects MIME/signature mismatches, arbitrary content and truncated signatures", () => {
  const html = new TextEncoder().encode("<!doctype html><html></html>");
  for (const screenshot of [
    imageDataUrl("png", jpegSignature),
    imageDataUrl("jpeg", pngSignature),
    imageDataUrl(
      "webp",
      Uint8Array.from({ length: 12 }, () => 0x41),
    ),
    imageDataUrl("png", html),
    imageDataUrl("png", pngSignature.slice(0, 7)),
    imageDataUrl("jpeg", jpegSignature.slice(0, 2)),
    imageDataUrl("webp", webpSignature.slice(0, 11)),
  ]) {
    invalid(
      () => parseConversationRequest({ ...input, screenshot }),
      "invalid_request",
    );
  }
});
test("preserves the 10 MiB decoded image limit", () => {
  const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  bytes.set(pngSignature);
  const atLimit = {
    ...input,
    screenshot: imageDataUrl("png", bytes.subarray(0, MAX_IMAGE_BYTES)),
  };
  assert.equal(
    parseConversationRequest(atLimit).screenshot,
    atLimit.screenshot,
  );
  invalid(
    () =>
      parseConversationRequest({
        ...input,
        screenshot: imageDataUrl("png", bytes),
      }),
    "invalid_request",
  );
});
test("rejects missing image, URLs, malformed base64, unsupported types, excessive request fields and invalid tone", () => {
  for (const value of [
    null,
    {},
    { ...input, screenshot: "https://example.com/chat.png" },
    { ...input, screenshot: "data:image/png;base64,broken" },
    { ...input, screenshot: "data:image/png;base64,%%%%" },
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

test("concurrency protection errors expose only safe typed messages", () => {
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const active = new ConversationError(
    "generation_in_progress",
    undefined,
    undefined,
    retryAt,
  );
  assert.equal(
    active.message,
    "A reply is already being generated. Please wait a moment.",
  );
  assert.equal(active.retryAt, retryAt);
  assert.equal(
    new ConversationError("generation_protection_unavailable").message,
    "WiNGR could not safely start a reply right now. Please try again.",
  );
});
