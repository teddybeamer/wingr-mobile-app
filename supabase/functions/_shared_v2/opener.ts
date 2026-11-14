// Start Conversation contract (ai-opener endpoint): one screenshot of a dating
// profile in, a read of the profile ("The Angle") and openers out. Request
// parsing and the result are checked strictly at both network boundaries, like
// the Get Replies contract in conversation.ts.
import {
  ConversationError,
  isReplyTone,
  isScreenshotDataUrl,
  MAX_REPLY_LENGTH,
  REPLY_TONES,
  type ReplyTone,
} from "./conversation.ts";

// Lets latency dashboards tell this contract apart from Get Replies without
// recording any image, profile text, opener, account identifier or body.
export const OPENER_OUTPUT_CONTRACT = "profile_openers_v1";

// "starters": the first read of a profile, with one opener per tone.
// "another": one more opener in the chosen tone (no new read).
export const OPENER_REQUEST_KINDS = ["starters", "another"] as const;
export type OpenerRequestKind = (typeof OPENER_REQUEST_KINDS)[number];

export const MAX_PREVIOUS_OPENERS = 6;
export const MIN_TOPICS = 3;
export const MAX_TOPICS = 6;
export const MAX_TOPIC_LENGTH = 40;
export const MAX_ANGLE_TEXT_LENGTH = 1000;

export type OpenerRequest = {
  kind: OpenerRequestKind;
  previousOpeners?: string[];
  screenshot: string;
  selectedTone?: ReplyTone;
};

export type ProfileAngle = {
  summary: string;
  topics: string[];
  yourMove: string;
};
export type Opener = { text: string; tone: ReplyTone };

// What the app receives: `angle` is null for "another".
export type OpenerResult = { angle: ProfileAngle | null; openers: Opener[] };

export const PROFILE_FAILURE_REASONS = [
  "unreadable_image",
  "not_a_profile",
] as const;
export type ProfileFailureReason = (typeof PROFILE_FAILURE_REASONS)[number];
export type UnusableProfileReason = ProfileFailureReason | "unknown";
export const UNUSABLE_PROFILE_REASONS = [
  ...PROFILE_FAILURE_REASONS,
  "unknown",
] as const;

export type ProviderOpenerResult = OpenerResult & {
  failureReason: UnusableProfileReason | null;
  usable: boolean;
};

export class UnusableProfileError extends ConversationError {
  constructor(public readonly reason: UnusableProfileReason) {
    super("unusable_screenshot");
  }
}

export function isUnusableProfileReason(
  value: unknown,
): value is UnusableProfileReason {
  return UNUSABLE_PROFILE_REASONS.includes(value as UnusableProfileReason);
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

export function parseOpenerRequest(value: unknown): OpenerRequest {
  const invalid = () => {
    throw new ConversationError("invalid_request");
  };
  if (!isObject(value)) return invalid();
  const kind = value.kind;
  if (!OPENER_REQUEST_KINDS.includes(kind as OpenerRequestKind))
    return invalid();
  if (!isScreenshotDataUrl(value.screenshot)) return invalid();
  if (kind === "starters") {
    // The first read writes one opener per tone, so neither field applies.
    if (value.selectedTone !== undefined || value.previousOpeners !== undefined)
      return invalid();
    return { kind, screenshot: value.screenshot };
  }
  if (!isReplyTone(value.selectedTone)) return invalid();
  const previous = value.previousOpeners;
  if (
    previous !== undefined &&
    (!Array.isArray(previous) ||
      previous.length === 0 ||
      previous.length > MAX_PREVIOUS_OPENERS ||
      previous.some((opener) => !text(opener, MAX_REPLY_LENGTH)))
  )
    return invalid();
  return {
    kind: "another",
    screenshot: value.screenshot,
    selectedTone: value.selectedTone,
    ...(previous ? { previousOpeners: previous as string[] } : {}),
  };
}

function isOpener(value: unknown): value is Opener {
  return (
    isObject(value) &&
    hasKeys(value, ["tone", "text"]) &&
    isReplyTone(value.tone) &&
    text(value.text, MAX_REPLY_LENGTH)
  );
}

function isAngle(value: unknown): value is ProfileAngle {
  return (
    isObject(value) &&
    hasKeys(value, ["summary", "topics", "yourMove"]) &&
    text(value.summary, MAX_ANGLE_TEXT_LENGTH) &&
    text(value.yourMove, MAX_ANGLE_TEXT_LENGTH) &&
    Array.isArray(value.topics) &&
    value.topics.length >= MIN_TOPICS &&
    value.topics.length <= MAX_TOPICS &&
    value.topics.every((topic) => text(topic, MAX_TOPIC_LENGTH))
  );
}

// The public result for a request, checked against what was asked: "starters"
// has a read and exactly one opener per tone; "another" has no read and one
// opener in the chosen tone. No coercion, defaults or recovery.
export function parseOpenerResult(
  value: unknown,
  request: Pick<OpenerRequest, "kind" | "selectedTone">,
): OpenerResult {
  const invalid = () => {
    throw new ConversationError("invalid_output");
  };
  if (!isObject(value) || !hasKeys(value, ["angle", "openers"]))
    return invalid();
  if (!Array.isArray(value.openers) || !value.openers.every(isOpener))
    return invalid();
  const openers = value.openers as Opener[];
  if (request.kind === "starters") {
    if (!isAngle(value.angle) || openers.length !== REPLY_TONES.length)
      return invalid();
    const tones = new Set(openers.map((opener) => opener.tone));
    if (!REPLY_TONES.every((tone) => tones.has(tone))) return invalid();
  } else if (
    value.angle !== null ||
    openers.length !== 1 ||
    openers[0].tone !== request.selectedTone
  )
    return invalid();
  return { angle: value.angle as ProfileAngle | null, openers };
}

// The provider may also say the screenshot cannot be used, with a diagnostic
// reason. Usable results are as strict as the public contract.
export function parseProviderOpenerResult(
  value: unknown,
  request: Pick<OpenerRequest, "kind" | "selectedTone">,
): ProviderOpenerResult {
  const invalid = () => {
    throw new ConversationError("invalid_output");
  };
  if (
    !isObject(value) ||
    !hasKeys(value, ["usable", "failureReason", "angle", "openers"]) ||
    typeof value.usable !== "boolean"
  )
    return invalid();
  if (value.usable) {
    if (value.failureReason !== null) return invalid();
    return {
      ...parseOpenerResult(
        { angle: value.angle, openers: value.openers },
        request,
      ),
      failureReason: null,
      usable: true,
    };
  }
  if (
    value.angle !== null ||
    !Array.isArray(value.openers) ||
    value.openers.length !== 0
  )
    return invalid();
  return {
    angle: null,
    failureReason: PROFILE_FAILURE_REASONS.includes(
      value.failureReason as ProfileFailureReason,
    )
      ? (value.failureReason as ProfileFailureReason)
      : "unknown",
    openers: [],
    usable: false,
  };
}

export function toPublicOpenerResult(
  result: ProviderOpenerResult,
): OpenerResult {
  return { angle: result.angle, openers: result.openers };
}

// Kept within Gemini's supported JSON Schema subset; counts, lengths and the
// one-opener-per-tone rule are enforced by the parsers above.
const shortText = { type: "string" };
export const openerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["usable", "failureReason", "angle", "openers"],
  properties: {
    usable: { type: "boolean" },
    failureReason: {
      type: ["string", "null"],
      enum: [...PROFILE_FAILURE_REASONS, null],
    },
    angle: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["summary", "topics", "yourMove"],
      properties: {
        summary: shortText,
        topics: { type: "array", maxItems: MAX_TOPICS, items: shortText },
        yourMove: shortText,
      },
    },
    openers: {
      type: "array",
      maxItems: REPLY_TONES.length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "text"],
        properties: {
          tone: { type: "string", enum: REPLY_TONES },
          text: shortText,
        },
      },
    },
  },
};
