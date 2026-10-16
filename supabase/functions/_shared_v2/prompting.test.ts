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
  assert.match(SYSTEM_PROMPT, /Keep schema enums exactly as specified/);
});

test("one language is chosen per response and applies to every user-facing AI text field", () => {
  assert.match(SYSTEM_PROMPT, /Choose ONE output language per response, including English and Danish/);
  assert.match(SYSTEM_PROMPT, /latest meaningful exchange, meaning THEM's most recent meaningful messages and ME's latest replies/);
  assert.match(
    SYSTEM_PROMPT,
    /Write the reply and every user-facing vibeCheck text field \(conversationEnergy, risk, summary\) in that same language, and never mix languages within one response/,
  );
  for (const ignored of ["the app's UI language", "the language of the user context", "older messages", "names", "haha or emoji"])
    assert.ok(SYSTEM_PROMPT.includes(ignored), ignored);
  // The old split rule (reply language vs separate vibe-field sentence) is gone.
  assert.doesNotMatch(SYSTEM_PROMPT, /Write free-text vibe fields in that language too/);
  assert.doesNotMatch(SYSTEM_PROMPT, /Match the actual conversation language/);
  // It names exactly the user-facing text fields; enums and the JSON contract are not language-dependent.
  assert.equal(SYSTEM_PROMPT.match(/Choose ONE output language/g)?.length, 1);
});

test("the language rule leaves the personal vibe tone and sender rules in place", () => {
  assert.match(SYSTEM_PROMPT, /directly to the user, as a short, personal observation from a friend/);
  assert.match(SYSTEM_PROMPT, /ME and THEM are internal labels/);
  assert.match(SYSTEM_PROMPT, /Infer ME\/THEM primarily from the whole visual structure/);
  assert.match(SYSTEM_PROMPT, /The reply itself stays in ME's own voice/);
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

test("replyable=false is limited to unusable screenshots; missing context never rejects", () => {
  assert.match(
    SYSTEM_PROMPT,
    /Return replyable=false and no replies only when there is no readable conversation, ownership cannot be determined reliably, or there is no readable conversational message that ME could reasonably respond to\./,
  );
  assert.match(
    SYSTEM_PROMPT,
    /Missing personal information, missing background or uncertainty about the ideal reply is never a reason for replyable=false/,
  );
  assert.doesNotMatch(SYSTEM_PROMPT, /no safe conversational hook/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /mark it unreplyable/i);
  assert.match(SYSTEM_PROMPT, /For no conversation return vibeCheck=null and replies=\[\]/);
  assert.match(SYSTEM_PROMPT, /Do not fabricate a conversation or generic flirting to fill the schema/);
  assert.equal(SYSTEM_PROMPT.match(/replyable=false/g)?.length, 2);
});

test("unknown personal information still gets a reply, without invented facts or commitments", () => {
  assert.match(SYSTEM_PROMPT, /never state or imply one, but still write a reply/);
  assert.match(SYSTEM_PROMPT, /natural, contextual, engaging one that keeps the conversation moving/);
  assert.match(SYSTEM_PROMPT, /stays true whatever the real answer is/);
  assert.match(SYSTEM_PROMPT, /Avoid generic deflections and mechanically returning the question to THEM/);
  assert.match(SYSTEM_PROMPT, /do not commit ME to a specific fact, plan, time or place/);
});

test("ownership and factual-grounding protections survive the replyability change", () => {
  for (const rule of [
    /Never invent personal facts about either person in the transcript, vibe or reply/,
    /User context may establish additional facts only where its owner is explicit/,
    /do not complete missing words or invent unseen text/,
    /do not answer ME's own question as if THEM wrote it or imply an unseen response/,
    /Do not overstate interest, feelings or intentions, and do not invent details/,
    /A partially cropped bubble, including the bottom message, is still a valid message/,
  ])
    assert.match(SYSTEM_PROMPT, rule);
});
