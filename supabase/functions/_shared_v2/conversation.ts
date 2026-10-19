// Compact response contract (v2) used by the ai-conversation-v2 endpoint and by
// WiNGR 1.0.0 (2). The production v1 endpoint and its `_shared` modules keep the
// original contract, which still requires `messages`, so installed builds are
// unaffected. Everything that is not part of the response contract (request
// parsing and limits, ConversationError and its kinds, tone and vibe types) is
// re-exported from the shared module so there is exactly one ConversationError
// class: usage-limit.ts and the trial manager throw it and the handler matches
// it with instanceof.
export * from "../_shared/conversation.ts";
import {
  ConversationError,
  isReplyTone,
  MAX_REPLY_LENGTH,
  REPLY_TONES,
  type VibeCheck,
} from "../_shared/conversation.ts";

// Lets latency dashboards compare this compact response shape without recording
// any screenshot, transcript, reply text, account identifier, or request body.
export const AI_OUTPUT_CONTRACT = "vibe_reply_no_transcript_v1";
export type ConversationResult = {
  replyable: boolean;
  vibeCheck: VibeCheck | null;
  replies: string[];
};

export const SEMANTIC_FAILURE_REASONS = [
  "unreadable_image",
  "no_conversation",
  "ownership_unclear",
  "no_replyable_message",
] as const;
export type SemanticFailureReason = (typeof SEMANTIC_FAILURE_REASONS)[number];
export type UnusableScreenshotReason = SemanticFailureReason | "unknown";
export const UNUSABLE_SCREENSHOT_REASONS = [
  ...SEMANTIC_FAILURE_REASONS,
  "unknown",
] as const;
export type ProviderConversationResult = ConversationResult & {
  failureReason: SemanticFailureReason | "unknown" | null;
};

export class UnusableScreenshotError extends ConversationError {
  constructor(public readonly reason: UnusableScreenshotReason) {
    super("unusable_screenshot");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

// The same strict contract is checked at both network boundaries. No coercion,
// invented defaults, or markdown/JSON recovery is performed.
export function parseConversationResult(value: unknown): ConversationResult {
  const invalid = () => {
    throw new ConversationError("invalid_output");
  };
  if (
    !isObject(value) ||
    !hasKeys(value, ["replyable", "vibeCheck", "replies"])
  )
    return invalid();
  if (
    typeof value.replyable !== "boolean" ||
    !Array.isArray(value.replies) ||
    value.replies.length > 1
  )
    return invalid();
  for (const reply of value.replies)
    if (!text(reply, MAX_REPLY_LENGTH)) return invalid();
  if (value.vibeCheck !== null) {
    const vibe = value.vibeCheck;
    if (
      !isObject(vibe) ||
      !hasKeys(vibe, [
        "interestLevel",
        "conversationEnergy",
        "bestTone",
        "risk",
        "summary",
      ]) ||
      !["Low", "Medium", "High", "Unclear"].includes(
        vibe.interestLevel as string,
      ) ||
      !isReplyTone(vibe.bestTone) ||
      !text(vibe.conversationEnergy, 1000) ||
      !text(vibe.risk, 1000) ||
      !text(vibe.summary, 1000)
    )
      return invalid();
  }
  if (!value.replyable) {
    if (value.replies.length !== 0) return invalid();
  } else if (!value.vibeCheck || value.replies.length !== 1) return invalid();
  return value as ConversationResult;
}

export function isSemanticFailureReason(
  value: unknown,
): value is SemanticFailureReason {
  return SEMANTIC_FAILURE_REASONS.includes(value as SemanticFailureReason);
}

export function isUnusableScreenshotReason(
  value: unknown,
): value is UnusableScreenshotReason {
  return UNUSABLE_SCREENSHOT_REASONS.includes(
    value as UnusableScreenshotReason,
  );
}

// The diagnostic is tolerant only after Gemini has already returned an
// otherwise valid replyable=false result. Successful results remain strict.
export function parseProviderConversationResult(
  value: unknown,
): ProviderConversationResult {
  const invalid = () => {
    throw new ConversationError("invalid_output");
  };
  if (!isObject(value)) return invalid();
  const allowedKeys = ["replyable", "failureReason", "vibeCheck", "replies"];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key)))
    return invalid();
  if (
    !("replyable" in value) ||
    !("vibeCheck" in value) ||
    !("replies" in value)
  )
    return invalid();

  const publicResult = parseConversationResult({
    replyable: value.replyable,
    vibeCheck: value.vibeCheck,
    replies: value.replies,
  });
  if (publicResult.replyable) {
    if (!("failureReason" in value) || value.failureReason !== null)
      return invalid();
    return { ...publicResult, failureReason: null };
  }
  return {
    ...publicResult,
    failureReason: isSemanticFailureReason(value.failureReason)
      ? value.failureReason
      : "unknown",
  };
}

export function toPublicConversationResult(
  result: ProviderConversationResult,
): ConversationResult {
  return {
    replyable: result.replyable,
    vibeCheck: result.vibeCheck,
    replies: result.replies,
  };
}

// Keep the provider schema within Gemini's supported JSON Schema subset.
// Length, item-count and nonempty limits remain enforced by parseConversationResult.
const shortText = { type: "string" };
export const conversationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["replyable", "failureReason", "vibeCheck", "replies"],
  properties: {
    replyable: { type: "boolean" },
    failureReason: {
      type: ["string", "null"],
      enum: [...SEMANTIC_FAILURE_REASONS, null],
    },
    vibeCheck: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "interestLevel",
        "conversationEnergy",
        "bestTone",
        "risk",
        "summary",
      ],
      properties: {
        interestLevel: {
          type: "string",
          enum: ["Low", "Medium", "High", "Unclear"],
        },
        conversationEnergy: shortText,
        bestTone: { type: "string", enum: REPLY_TONES },
        risk: shortText,
        summary: shortText,
      },
    },
    replies: { type: "array", maxItems: 1, items: { type: "string" } },
  },
};
