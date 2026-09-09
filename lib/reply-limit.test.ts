import assert from "node:assert/strict";
import test from "node:test";
import { getReplyErrorPresentation } from "./reply-limit";
import { ConversationError, parseRetryAt } from "../supabase/functions/_shared/conversation";

test("limit notice uses local English date/time, rounds up, and dismisses", (t) => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Copenhagen";
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  for (const [retryAt, expected] of [
    ["2026-10-09T14:34:00Z", "9 October at 16:34"],
    ["2026-10-09T14:34:00.000001Z", "9 October at 16:35"],
    ["2026-10-09T21:59:59Z", "10 October at 00:00"],
    ["2026-10-25T01:30:00Z", "25 October at 02:30"],
    ["2026-12-31T22:59:59Z", "1 January at 00:00"],
  ]) {
    assert.deepEqual(getReplyErrorPresentation({ code: "usage_limit", message: "old message", retryAt }), {
      title: "Reply limit reached",
      message: `You’ve reached your reply limit. You’ll get more replies on ${expected}.`,
      primaryLabel: "Got it",
      dismiss: true,
    });
  }
});

test("missing and invalid timestamps produce the safe limit fallback", () => {
  for (const retryAt of [undefined, "", "PRIVATE", "2026-02-30T12:00:00Z", "2026-10-09", "2026-10-09T25:00:00Z"]) {
    assert.equal(parseRetryAt(retryAt), undefined);
    assert.deepEqual(getReplyErrorPresentation({ code: "usage_limit", message: "old message", retryAt }), {
      title: "Reply limit reached",
      message: "You’ve reached your reply limit. Please check back later.",
      primaryLabel: "Got it",
      dismiss: true,
    });
  }
  assert.equal(parseRetryAt(123), undefined);
  assert.equal(new ConversationError("provider", undefined, undefined, "2026-10-09T14:34:00Z").retryAt, undefined);
});

test("other errors keep their original message and retry action", () => {
  assert.deepEqual(getReplyErrorPresentation({ code: "provider", message: "Provider unavailable" }), {
    title: "Something went wrong", message: "Provider unavailable", primaryLabel: "Try again", dismiss: false,
  });
});
