import assert from "node:assert/strict";
import test from "node:test";
import { ConversationApiError } from "./wingr-api";
import { selectPreviousOpeners } from "./wingr-opener";

const card = (index: number) => ({
  id: `opener-${index}`,
  text: `Opener ${index}`,
  tone: "playful" as const,
});

test("the next opener is told about the last six openers shown", () => {
  const openers = Array.from({ length: 8 }, (_, index) => card(index));
  assert.deepEqual(selectPreviousOpeners(openers), [
    "Opener 2",
    "Opener 3",
    "Opener 4",
    "Opener 5",
    "Opener 6",
    "Opener 7",
  ]);
  assert.deepEqual(selectPreviousOpeners([]), []);
});

test("an unusable profile keeps its reason; chat reasons stay separate", () => {
  const profile = new ConversationApiError(
    "unusable_screenshot",
    "unusable_screenshot",
    422,
    "not_a_profile",
  );
  assert.equal(profile.profileFailureReason, "not_a_profile");
  assert.equal(profile.failureReason, "unknown");

  const chat = new ConversationApiError(
    "unusable_screenshot",
    "unusable_screenshot",
    422,
    "no_conversation",
  );
  assert.equal(chat.failureReason, "no_conversation");
  assert.equal(chat.profileFailureReason, "unknown");
});
