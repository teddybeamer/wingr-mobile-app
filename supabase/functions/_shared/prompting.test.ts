import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationSchema,
  parseConversationResult,
  type ConversationRequest,
} from "./conversation.ts";
import { buildConversationPrompt, SYSTEM_PROMPT } from "./prompting.ts";
import { result } from "./test-fixtures.ts";

test("vibe check text is addressed directly to the user in second person", () => {
  assert.match(SYSTEM_PROMPT, /conversationEnergy, risk, summary\) directly to the user/);
  assert.match(SYSTEM_PROMPT, /personal observation from a friend/);
  assert.match(SYSTEM_PROMPT, /"you", "your", "you both", "both of you"/);
  assert.match(SYSTEM_PROMPT, /"they", "their" or THEM's name/);
});

test("ME and THEM stay internal and report-style openings are discouraged", () => {
  assert.match(SYSTEM_PROMPT, /ME and THEM are internal labels for working out who sent what/);
  assert.match(SYSTEM_PROMPT, /never write ME, THEM, "the user" or "the other person" in these fields/);
  assert.match(SYSTEM_PROMPT, /"Both agreed\.\.\."/);
  assert.match(SYSTEM_PROMPT, /"The conversation shows\.\.\."/);
});

test("direct address is natural, not mechanical, and does not invite overreading", () => {
  assert.match(SYSTEM_PROMPT, /Not every sentence needs "you"/);
  assert.doesNotMatch(SYSTEM_PROMPT, /every sentence must/i);
  assert.match(SYSTEM_PROMPT, /Do not overstate interest, feelings or intentions, and do not invent details/);
  assert.match(SYSTEM_PROMPT, /The reply itself stays in ME's own voice/);
});

test("sender identification and language rules are untouched", () => {
  assert.match(SYSTEM_PROMPT, /Infer ME\/THEM primarily from the whole visual structure/);
  assert.match(SYSTEM_PROMPT, /alignment alone is not ownership/);
  assert.match(SYSTEM_PROMPT, /facts stated by ME belong to ME/i);
  assert.match(SYSTEM_PROMPT, /Write free-text vibe fields in that language too; keep schema enums exactly as specified/);
});

test("the JSON contract and the user prompt are unchanged", () => {
  const vibe = conversationSchema.properties.vibeCheck as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assert.deepEqual(Object.keys(conversationSchema.properties), ["replyable", "vibeCheck", "replies"]);
  assert.deepEqual(vibe.required, ["interestLevel", "conversationEnergy", "bestTone", "risk", "summary"]);
  assert.deepEqual(Object.keys(vibe.properties), vibe.required);
  assert.deepEqual(parseConversationResult(result), result);
  assert.throws(() =>
    parseConversationResult({ ...result, vibeCheck: { ...result.vibeCheck, extra: "x" } }),
  );
  const request = { selectedTone: "playful", extraContext: " hi " } as ConversationRequest;
  assert.equal(buildConversationPrompt(request), '{"selectedTone":"playful","extraContext":"hi"}');
});
