import assert from "node:assert/strict";
import test from "node:test";
import {
  needsSpeakerConfirmation,
  reconstructConversationFromLabeledTranscript,
  reconstructConversationFromOcrLines,
  type OcrLineInput,
} from "./wingr-ocr";

test("reconstructs the backend OCR transcript without changing speaker ownership", () => {
  const result = reconstructConversationFromLabeledTranscript(
    ["Them: coffee tomorrow?", "You: sounds good", "THEM: how about ten?"].join(
      "\n",
    ),
  );

  assert.equal(result.source, "backend");
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);
  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "coffee tomorrow?" },
    { speaker: "me", text: "sounds good" },
    { speaker: "them", text: "how about ten?" },
  ]);
});

function line(
  text: string,
  left: number,
  top: number,
  right: number,
  bottom = top + 18,
  recognizedLanguages?: string[],
): OcrLineInput {
  return {
    frame: { bottom, left, right, top },
    recognizedLanguages,
    text,
  };
}

test("merges a wrapped message without merging the next bubble", () => {
  const result = reconstructConversationFromOcrLines([
    line("I had a really good time", 24, 100, 190),
    line("with you yesterday.", 24, 122, 165),
    line("Me too, let us do it again.", 236, 166, 350),
    line("Delivered", 296, 190, 350, 204),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "I had a really good time with you yesterday." },
    { speaker: "me", text: "Me too, let us do it again." },
  ]);
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);
});

test("keeps very short replies in their established columns", () => {
  const result = reconstructConversationFromOcrLines([
    line("ok", 24, 100, 46),
    line("yeah", 282, 142, 326),
    line("lol", 296, 176, 326),
    line("Read", 292, 200, 326, 214),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "ok" },
    { speaker: "me", text: "yeah" },
    { speaker: "me", text: "lol" },
  ]);
});

test("keeps consecutive same-side messages separate and consistently attributed", () => {
  const result = reconstructConversationFromOcrLines([
    line("How was your meeting?", 20, 100, 158),
    line("It went well.", 238, 140, 332),
    line("I will tell you more later.", 228, 174, 350),
    line("Delivered", 296, 198, 350, 212),
    line("Looking forward to it.", 22, 236, 168),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.speaker,
    ),
    ["them", "me", "me", "them"],
  );
  assert.equal(result.detectedMessages.length, 4);
});

test("learns columns from a cropped screenshot instead of absolute screen position", () => {
  const result = reconstructConversationFromOcrLines([
    line("Are you still around?", 422, 100, 554),
    line("Yes, I am on my way.", 640, 140, 780),
    line("Perfect.", 438, 180, 500),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "Are you still around?" },
    { speaker: "me", text: "Yes, I am on my way." },
    { speaker: "them", text: "Perfect." },
  ]);
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);
});

test("uses confirmation only when a sparse screenshot has no resolved column mapping", () => {
  const result = reconstructConversationFromOcrLines([
    line("Still thinking about that dinner", 250, 100, 440),
  ]);

  assert.equal(result.parsedConversation.speakerAttributionResolved, false);
  assert.equal(result.detectedMessages[0]?.sender, "unknown");
  assert.equal(needsSpeakerConfirmation(result.parsedConversation), true);
});

test("removes timestamps and receipts while using the receipt as an outgoing anchor", () => {
  const result = reconstructConversationFromOcrLines([
    line("12:34", 170, 72, 210),
    line("Want to get coffee?", 24, 108, 150),
    line("Absolutely.", 276, 148, 350),
    line("Delivered", 296, 172, 350, 186),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "Want to get coffee?" },
    { speaker: "me", text: "Absolutely." },
  ]);
  assert.equal(result.transcriptText.includes("12:34"), false);
  assert.equal(result.transcriptText.includes("Delivered"), false);
});

test("preserves unambiguous ML Kit language evidence on reconstructed messages", () => {
  const result = reconstructConversationFromOcrLines([
    line("I had a really good time", 24, 100, 190, 118, ["en"]),
    line("with you yesterday.", 24, 122, 165, 140, ["en"]),
    line("Me too.", 276, 166, 350, 184, ["en", "fr"]),
    line("Delivered", 296, 190, 350, 204),
  ]);

  assert.deepEqual(result.detectedMessages[0]?.languageEvidence, [
    { tag: "en", lineCount: 2 },
  ]);
  assert.equal(result.detectedMessages[1]?.languageEvidence, undefined);
});
