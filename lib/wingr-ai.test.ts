import assert from "node:assert/strict";
import test from "node:test";
import { selectPreviousWingrSuggestions, toAppResult } from "./wingr-ai";
import { result } from "../supabase/functions/_shared/test-fixtures";

test("maps the combined response to existing vibe and reply card fields without another request", () => {
  const value = toAppResult(result, "playful", 12);
  assert.deepEqual(value.vibeCheck, result.vibeCheck);
  assert.deepEqual(value.messages, result.messages);
  assert.deepEqual(value.replies, [
    { id: "12-0", tone: "playful", text: result.replies[0] },
  ]);
  assert.notEqual(
    toAppResult(result, "direct", 13).replies[0].id,
    value.replies[0].id,
  );
});
test("does not manufacture replies or vibes for unusable or malformed results", () => {
  assert.throws(() =>
    toAppResult(
      { messages: [], replyable: false, vibeCheck: null, replies: [] },
      "direct",
      1,
    ),
  );
  assert.throws(() => toAppResult({ ...result, vibeCheck: {} }, "direct", 1));
});

test("selects up to the latest three displayed Wingr replies for refresh", () => {
  const reply = (text: string) => ({ id: text, tone: "playful" as const, text });
  assert.deepEqual(selectPreviousWingrSuggestions([]), []);
  assert.deepEqual(selectPreviousWingrSuggestions([reply("one")]), ["one"]);
  assert.deepEqual(selectPreviousWingrSuggestions([reply("one"), reply("two")]), [
    "one",
    "two",
  ]);
  assert.deepEqual(
    selectPreviousWingrSuggestions([
      reply("one"),
      reply("two"),
      reply("three"),
      reply("four"),
    ]),
    ["two", "three", "four"],
  );
});
