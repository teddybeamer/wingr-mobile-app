import assert from "node:assert/strict";
import test from "node:test";
import {
  FIRST_INDICATOR_MS,
  HOLD_MS,
  INITIAL_CHAT_STATE,
  NEXT_INDICATOR_MS,
  TYPING_MS_PER_LETTER,
  advanceChat,
  getChatStepDelay,
  type ChatState,
} from "./loading-chat";

const MESSAGES = ["Hi", "Okay"] as const;

test("the chat starts with the typing indicator for about a second", () => {
  assert.deepEqual(INITIAL_CHAT_STATE, { phase: "indicator", shown: 0 });
  assert.equal(
    getChatStepDelay(INITIAL_CHAT_STATE, MESSAGES),
    FIRST_INDICATOR_MS,
  );
  assert.equal(FIRST_INDICATOR_MS, 1000);
});

test("the indicator becomes the first message, typed letter by letter", () => {
  let state = advanceChat(INITIAL_CHAT_STATE, MESSAGES);
  assert.deepEqual(state, { phase: "typing", shown: 0, typed: 0 });
  assert.equal(getChatStepDelay(state, MESSAGES), TYPING_MS_PER_LETTER);

  state = advanceChat(state, MESSAGES);
  assert.deepEqual(state, { phase: "typing", shown: 0, typed: 1 });
  state = advanceChat(state, MESSAGES);
  assert.deepEqual(state, { phase: "typing", shown: 0, typed: 2 });
});

test("a fully typed message holds, then a shorter indicator starts the next", () => {
  const typed: ChatState = { phase: "typing", shown: 0, typed: 2 };
  assert.equal(getChatStepDelay(typed, MESSAGES), HOLD_MS);

  const next = advanceChat(typed, MESSAGES);
  assert.deepEqual(next, { phase: "indicator", shown: 1 });
  assert.equal(getChatStepDelay(next, MESSAGES), NEXT_INDICATOR_MS);
});

test("after the last message the indicator waits and the timeline ends", () => {
  const last: ChatState = { phase: "typing", shown: 1, typed: 4 };
  const waiting = advanceChat(last, MESSAGES);
  assert.deepEqual(waiting, { phase: "waiting", shown: 2 });
  assert.equal(getChatStepDelay(waiting, MESSAGES), null);
  assert.equal(advanceChat(waiting, MESSAGES), waiting);
});

test("running the whole timeline types every message in order, then stops", () => {
  let state: ChatState = INITIAL_CHAT_STATE;
  const finished: number[] = [];
  let elapsed = 0;
  let steps = 0;

  while (getChatStepDelay(state, MESSAGES) !== null) {
    elapsed += getChatStepDelay(state, MESSAGES) ?? 0;
    const next = advanceChat(state, MESSAGES);
    if (state.phase === "typing" && next.phase !== "typing") {
      finished.push(state.shown);
    }
    state = next;
    assert.ok(++steps < 100, "timeline must end");
  }

  assert.deepEqual(finished, [0, 1]);
  assert.equal(state.phase, "waiting");
  // first indicator + "Hi" + hold + second indicator + "Okay" + hold
  // (the per-letter delay is fractional, so allow for floating point rounding)
  const expected =
    FIRST_INDICATOR_MS +
    2 * TYPING_MS_PER_LETTER +
    HOLD_MS +
    NEXT_INDICATOR_MS +
    4 * TYPING_MS_PER_LETTER +
    HOLD_MS;
  assert.ok(Math.abs(elapsed - expected) < 1e-6, `${elapsed} vs ${expected}`);
});
