import assert from "node:assert/strict";
import test from "node:test";
import {
  needsSpeakerConfirmation,
  reconstructConversationFromOcrLines,
  type OcrLineInput,
} from "./wingr-ocr";
import {
  resolveVisualBubbleAttributionFromEvidence,
} from "./visual-bubble-attribution";
import type { DetectedMessage } from "../types/wingr";

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
  assert.equal(result.geometryAttributionAmbiguous, false);
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

test("does not turn a punctuation-only header control into a chat message", () => {
  const result = reconstructConversationFromOcrLines([
    line("...", 314, 36, 346),
    line("Hey", 252, 110, 300),
    line("How is your week going?", 22, 174, 186),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.text,
    ),
    ["Hey", "How is your week going?"],
  );
});

test("removes a compact top-right header control even when OCR reads it as words", () => {
  const result = reconstructConversationFromOcrLines([
    line("menu item", 310, 36, 350),
    line("Hey", 252, 110, 300),
    line("How is your week going?", 22, 174, 186),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.text,
    ),
    ["Hey", "How is your week going?"],
  );
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

test("uses relative visual styles, right extent, and avatar evidence for ambiguous Hinge geometry", () => {
  const messages: DetectedMessage[] = [
    {
      boundingBox: { height: 80, width: 510, x: 182, y: 420 },
      confidence: 0.45,
      id: "message-1",
      sender: "unknown",
      speaker: "unknown",
      text: "Sounds fun 😌 I just got back from the gym. About to go game a bit 🤓",
      xPosition: "center",
    },
    {
      boundingBox: { height: 120, width: 500, x: 171, y: 530 },
      confidence: 0.45,
      id: "message-2",
      sender: "unknown",
      speaker: "unknown",
      text: "Sounds like a solid evening 😌 Gym done, now gaming mode activated 🤓 What are you playing?",
      xPosition: "center",
    },
    {
      boundingBox: { height: 160, width: 530, x: 182, y: 690 },
      confidence: 0.45,
      id: "message-3",
      sender: "unknown",
      speaker: "unknown",
      text: "Hehe yeah! I played a game of Dota 2. Do you know it?",
      xPosition: "center",
    },
    {
      boundingBox: { height: 160, width: 510, x: 171, y: 900 },
      confidence: 0.45,
      id: "message-4",
      sender: "unknown",
      speaker: "unknown",
      text: "I actually had not heard of Dota 2 before. What is your favorite game?",
      xPosition: "center",
    },
  ];
  const result = resolveVisualBubbleAttributionFromEvidence(messages, [
    {
      avatarVariance: 12,
      backgroundVariance: 8,
      bubbleColor: { blue: 116, green: 42, red: 111 },
      id: "message-1",
      leftExtent: 0.19,
      rightExtent: 0.88,
    },
    {
      avatarVariance: 720,
      backgroundVariance: 8,
      bubbleColor: { blue: 238, green: 238, red: 238 },
      id: "message-2",
      leftExtent: 0.18,
      rightExtent: 0.76,
    },
    {
      avatarVariance: 10,
      backgroundVariance: 8,
      bubbleColor: { blue: 116, green: 42, red: 111 },
      id: "message-3",
      leftExtent: 0.19,
      rightExtent: 0.9,
    },
    {
      avatarVariance: 680,
      backgroundVariance: 8,
      bubbleColor: { blue: 238, green: 238, red: 238 },
      id: "message-4",
      leftExtent: 0.18,
      rightExtent: 0.77,
    },
  ]);

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them", "me", "them"],
  );
  assert.ok((result?.confidence ?? 0) >= 0.68);
});

test("visual attribution corrects a confident geometry-only Hinge-style layout", () => {
  const messages: DetectedMessage[] = [
    visualMessage("norway-me", 292, 560),
    visualMessage("roommate-them", 162, 620),
    visualMessage("storm-them", 162, 610),
  ];
  const result = resolveVisualBubbleAttributionFromEvidence(messages, [
    {
      avatarVariance: 12,
      backgroundVariance: 8,
      bubbleColor: { blue: 34, green: 0, red: 51 },
      id: "norway-me",
      leftExtent: 0.31,
      rightExtent: 0.9,
    },
    {
      avatarVariance: 640,
      backgroundVariance: 8,
      bubbleColor: { blue: 232, green: 232, red: 232 },
      id: "roommate-them",
      leftExtent: 0.17,
      rightExtent: 0.82,
    },
    {
      avatarVariance: 680,
      backgroundVariance: 8,
      bubbleColor: { blue: 232, green: 232, red: 232 },
      id: "storm-them",
      leftExtent: 0.17,
      rightExtent: 0.81,
    },
  ]);

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them", "them"],
  );
  assert.ok((result?.confidence ?? 0) >= 0.68);
});

function visualMessage(id: string, x: number, width: number): DetectedMessage {
  return {
    boundingBox: { height: 90, width, x, y: 100 },
    confidence: 0.4,
    id,
    sender: "unknown",
    speaker: "unknown",
    text: `Message ${id}`,
    xPosition: "center",
  };
}

test("uses visual styles for an unknown app and a different color theme without avatars", () => {
  const result = resolveVisualBubbleAttributionFromEvidence(
    [visualMessage("one", 190, 640), visualMessage("two", 130, 600)],
    [
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 42, green: 178, red: 28 },
        id: "one",
        leftExtent: 0.19,
        rightExtent: 0.9,
      },
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 210, green: 75, red: 240 },
        id: "two",
        leftExtent: 0.13,
        rightExtent: 0.73,
      },
    ],
  );

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them"],
  );
});

test("keeps manual confirmation available when visual styles and geometry are both weak", () => {
  const result = resolveVisualBubbleAttributionFromEvidence(
    [visualMessage("one", 190, 550), visualMessage("two", 185, 545)],
    [
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 140, green: 140, red: 140 },
        id: "one",
        leftExtent: 0.19,
        rightExtent: 0.74,
      },
      {
        avatarVariance: 9,
        backgroundVariance: 7,
        bubbleColor: { blue: 145, green: 144, red: 143 },
        id: "two",
        leftExtent: 0.18,
        rightExtent: 0.73,
      },
    ],
  );

  assert.equal(result, null);
});
