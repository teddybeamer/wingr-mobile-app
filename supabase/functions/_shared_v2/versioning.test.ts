import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as v1 from "../_shared/conversation.ts";
import { result as v1Result } from "../_shared/test-fixtures.ts";
import * as v2 from "./conversation.ts";
import {
  DEFAULT_REASONING_EFFORT,
  parseReasoningEffort,
} from "./openrouter.ts";
import { result as v2Result } from "./test-fixtures.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("the two response contracts are deliberately incompatible, so they need separate endpoints", () => {
  // Build 1 (production /ai-conversation) requires `messages`; build 2 forbids it.
  assert.deepEqual(v1.parseConversationResult(v1Result), v1Result);
  assert.deepEqual(v2.parseConversationResult(v2Result), v2Result);
  assert.throws(() => v1.parseConversationResult(v2Result), {
    kind: "invalid_output",
  });
  assert.throws(() => v2.parseConversationResult(v1Result), {
    kind: "invalid_output",
  });
  assert.deepEqual(Object.keys(v1.conversationSchema.properties), [
    "messages",
    "replyable",
    "vibeCheck",
    "replies",
  ]);
  assert.deepEqual(Object.keys(v2.conversationSchema.properties), [
    "replyable",
    "failureReason",
    "vibeCheck",
    "replies",
  ]);
});

test("v2 shares the one ConversationError class with the unchanged shared security modules", () => {
  // usage-limit.ts and the trial manager throw the v1-module class; the v2 handler
  // matches with instanceof, so a second class would silently misclassify errors.
  assert.equal(v2.ConversationError, v1.ConversationError);
  assert.equal(v2.parseConversationRequest, v1.parseConversationRequest);
  assert.equal(v2.CONVERSATION_ERROR_KINDS, v1.CONVERSATION_ERROR_KINDS);
  assert.equal(v2.AI_OUTPUT_CONTRACT, "vibe_reply_no_transcript_v1");
});

test("the v2 endpoint wires only v2 handler code and the unchanged shared security modules", () => {
  const index = read("../ai-conversation-v2/index.ts");
  assert.match(index, /from "\.\.\/_shared_v2\/analyze-conversation\.ts"/);
  assert.match(index, /from "\.\.\/_shared_v2\/openrouter\.ts"/);
  // v2 settles usage (charge on settlement); the original limiter, which charges at
  // claim time, stays with the frozen v1 endpoint.
  assert.match(index, /from "\.\.\/_shared_v2\/usage-limit\.ts"/);
  assert.doesNotMatch(index, /_shared\/usage-limit\.ts/);
  assert.match(
    read("../ai-conversation/index.ts"),
    /from "\.\.\/_shared\/usage-limit\.ts"/,
  );
  assert.doesNotMatch(
    read("../_shared_v2/analyze-conversation.ts"),
    /_shared\/usage-limit\.ts/,
  );
  // Same split for onboarding: v2 binds trials to the trial ID and re-checks the
  // device before releasing a reply; the shared manager stays with v1.
  assert.match(
    index,
    /createDeviceCheckOnboardingTrialManager,\s+createSupabaseOnboardingTrialStore,\s+\} from "\.\.\/_shared_v2\/onboarding-device-trial\.ts"/,
  );
  // The v2 store finalizes without recording an attempt; v1 keeps the shared one.
  assert.doesNotMatch(
    index,
    /createSupabaseOnboardingTrialStore[^;]*_shared\/onboarding-device-trial\.ts/s,
  );
  assert.match(
    read("../ai-conversation/index.ts"),
    /createSupabaseOnboardingTrialStore,[^;]*_shared\/onboarding-device-trial\.ts/s,
  );
  assert.doesNotMatch(
    index,
    /createDeviceCheckOnboardingTrialManager[^;]*_shared\/onboarding-device-trial\.ts/s,
  );
  assert.match(
    read("../ai-conversation/index.ts"),
    /createDeviceCheckOnboardingTrialManager,[^;]*_shared\/onboarding-device-trial\.ts/s,
  );
  for (const shared of [
    "revenuecat-entitlement",
    "onboarding-device-trial",
    "devicecheck",
  ])
    assert.match(index, new RegExp(`from "\\.\\./_shared/${shared}\\.ts"`));
  assert.doesNotMatch(
    index,
    /_shared\/(analyze-conversation|openrouter|prompting)\.ts/,
  );
  // Same secrets as v1 (project-wide); nothing endpoint-specific.
  const v1Index = read("../ai-conversation/index.ts");
  const envNames = (source: string) =>
    [...source.matchAll(/Deno\.env\.get\("([A-Z_]+)"\)/g)]
      .map((m) => m[1])
      .sort();
  assert.deepEqual(
    envNames(index).filter(
      (name) => name !== "AI_REASONING_EFFORT" && name !== "AI_MODEL",
    ),
    envNames(v1Index),
  );
});

test("the v1 endpoint still serves the original contract from the original shared modules", () => {
  const v1Index = read("../ai-conversation/index.ts");
  assert.match(v1Index, /from "\.\.\/_shared\/analyze-conversation\.ts"/);
  assert.doesNotMatch(v1Index, /_shared_v2/);
  assert.match(
    read("../_shared/prompting.ts"),
    /For no conversation return messages=\[\], vibeCheck=null/,
  );
  assert.match(
    read("../_shared/openrouter.ts"),
    /reasoning: \{ effort: "medium" \}/,
  );
});

test("v2 defaults to low reasoning; only the exact value medium switches it back", () => {
  assert.equal(DEFAULT_REASONING_EFFORT, "low");
  assert.equal(parseReasoningEffort(undefined), "low");
  assert.equal(parseReasoningEffort(null), "low");
  assert.equal(parseReasoningEffort(""), "low");
  assert.equal(parseReasoningEffort("high"), "low");
  assert.equal(parseReasoningEffort("MEDIUM"), "low");
  assert.equal(parseReasoningEffort(" medium "), "medium");
});

test("v2 function config requires a verified JWT like v1", () => {
  const config = read("../../config.toml");
  assert.match(
    config,
    /\[functions\.ai-conversation-v2\]\s*\nverify_jwt = true/,
  );
  assert.match(config, /\[functions\.ai-conversation\]\s*\nverify_jwt = true/);
});

test("v2 selects its model only from the optional AI_MODEL secret; v1 never reads it", () => {
  const index = read("../ai-conversation-v2/index.ts");
  assert.match(index, /model: parseModel\(Deno\.env\.get\("AI_MODEL"\)\)/);
  assert.doesNotMatch(read("../ai-conversation/index.ts"), /AI_MODEL/);
  assert.match(
    read("../_shared/openrouter.ts"),
    /export const GEMINI_MODEL = "google\/gemini-3\.8-flash"/,
  );
  assert.doesNotMatch(read("../_shared/openrouter.ts"), /deepseek/i);
});
