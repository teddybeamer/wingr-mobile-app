import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationLanguage } from "./language";
import type {
  DetectedMessage,
  MessageSender,
  ParsedConversation,
} from "./types";

function message(
  sender: Extract<MessageSender, "me" | "them">,
  text: string,
  languageEvidence?: DetectedMessage["languageEvidence"],
): DetectedMessage {
  return {
    boundingBox: { height: 20, width: 100, x: sender === "me" ? 200 : 20, y: 0 },
    confidence: 0.9,
    id: `${sender}-${text}`,
    languageEvidence,
    sender,
    speaker: sender === "me" ? "user" : "other",
    text,
    xPosition: sender === "me" ? "right" : "left",
  };
}

function conversation(messages: DetectedMessage[]): ParsedConversation {
  return {
    latestMessageSender: messages[messages.length - 1]?.sender ?? "unknown",
    messages,
    shouldGenerateDirectReply: messages[messages.length - 1]?.sender === "them",
    speakerAttributionConfidence: 0.9,
  };
}

function evidence(tag: string, lineCount = 1) {
  return [{ lineCount, tag }];
}

test("uses the dominant recent language when an early message is different", () => {
  const messages = [message("them", "Hvordan går det?", evidence("da"))];

  for (let index = 0; index < 8; index += 1) {
    messages.push(
      message(index % 2 === 0 ? "me" : "them", `English message ${index} with context`, evidence("en")),
    );
  }

  assert.equal(resolveConversationLanguage(conversation(messages)), "English");
});

test("does not switch language because of one isolated foreign phrase", () => {
  const messages = [
    message("them", "Hvordan har din dag været?", evidence("da")),
    message("me", "Den har været rigtig god indtil videre", evidence("da")),
    message("them", "Det lyder virkelig hyggeligt", evidence("da")),
    message("me", "Jeg glæder mig til weekenden", evidence("da")),
    message("them", "Det gør jeg også faktisk", evidence("da")),
    message("me", "This phrase is isolated", evidence("en")),
  ];

  assert.equal(resolveConversationLanguage(conversation(messages)), "Danish");
});

test("uses a consistent recent language transition", () => {
  const messages: DetectedMessage[] = [];

  for (let index = 0; index < 6; index += 1) {
    messages.push(message(index % 2 === 0 ? "them" : "me", `Dansk besked ${index} med indhold`, evidence("da")));
  }

  for (let index = 0; index < 6; index += 1) {
    messages.push(message(index % 2 === 0 ? "them" : "me", `Spanish message ${index} with context`, evidence("es")));
  }

  assert.equal(resolveConversationLanguage(conversation(messages)), "Spanish");
});

test("does not let recent neutral messages outweigh substantive conversation", () => {
  const messages = [
    message("them", "Hvordan har din dag været indtil videre?", evidence("da")),
    message("me", "Den har været god, jeg har haft travlt", evidence("da")),
    message("them", "Det lyder som en lang dag for dig", evidence("da")),
    message("me", "Ja men nu kan jeg endelig slappe af", evidence("da")),
    message("them", "haha", evidence("en")),
    message("me", "lol", evidence("en")),
    message("them", "ok", evidence("en")),
    message("me", "🙂", evidence("en")),
    message("them", "https://example.com", evidence("en")),
    message("me", "Alex", evidence("en")),
  ];

  assert.equal(resolveConversationLanguage(conversation(messages)), "Danish");
});

test("allows repeated ML Kit evidence to strengthen a neutral message", () => {
  const messages = [
    message("them", "Hvordan har din dag været?", evidence("da")),
    message("me", "haha", evidence("en", 2)),
    message("them", "lol", evidence("en", 2)),
  ];

  assert.equal(resolveConversationLanguage(conversation(messages)), "English");
});

test("uses the latest substantive THEM message only as a tie-breaker", () => {
  const messages = [
    message("them", "Mensaje español con bastante contexto", evidence("es")),
    message("me", "Mensaje español también con contexto", evidence("es")),
    message("me", "Message français avec du contexte", evidence("fr")),
    message("them", "Dernier message français avec contexte", evidence("fr")),
  ];

  assert.equal(resolveConversationLanguage(conversation(messages)), "French");
});

test("falls back when ML Kit language evidence is missing or ambiguous", () => {
  const messages = [
    message("them", "A readable message"),
    message("me", "Another readable message", [
      { lineCount: 1, tag: "en" },
      { lineCount: 1, tag: "fr" },
    ]),
  ];

  assert.equal(resolveConversationLanguage(conversation(messages)), undefined);
});
