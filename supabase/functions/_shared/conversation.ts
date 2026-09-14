export const REPLY_TONES = ["playful", "direct", "casualSmallTalk"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];
export type ConversationMessage = { speaker: "ME" | "THEM"; text: string };
export type VibeCheck = {
  interestLevel: "Low" | "Medium" | "High" | "Unclear";
  conversationEnergy: string;
  bestTone: ReplyTone;
  risk: string;
  summary: string;
};
export type ConversationRequest = {
  screenshot: string;
  selectedTone: ReplyTone;
  extraContext?: string;
  previousWingrSuggestions?: string[];
  isOnboardingGeneration?: boolean;
};
export type ConversationResult = {
  messages: ConversationMessage[];
  replyable: boolean;
  vibeCheck: VibeCheck | null;
  replies: string[];
};

export const CONVERSATION_ERROR_KINDS = [
  "invalid_request",
  "payload_too_large",
  "invalid_output",
  "unusable_screenshot",
  "provider",
  "timeout",
  "generation_in_progress",
  "generation_protection_unavailable",
  "usage_limit",
  "onboarding_reply_used",
] as const;
export type ConversationErrorKind = (typeof CONVERSATION_ERROR_KINDS)[number];

function validProviderStatus(status: unknown): status is number {
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  );
}

function providerErrorMessage(status: number) {
  const descriptions: Record<number, string> = {
    400: "The AI service rejected Wingr's request configuration or image input.",
    401: "Wingr's OpenRouter API key was rejected.",
    402: "Wingr's OpenRouter account or API key has insufficient credits.",
    403: "OpenRouter blocked access to this request.",
    404: "The requested AI model or provider route is unavailable.",
    429: "Wingr's AI service is rate-limited. Please try again shortly.",
    503: "No AI provider is currently available for Wingr's request.",
  };
  return `${descriptions[status] ?? "Wingr's AI provider could not complete the request."} (OpenRouter ${status})`;
}

export const PROVIDER_ERROR_REASONS = {
  model_unavailable:
    "OpenRouter does not accept the configured model identifier.",
  user_required: "OpenRouter requires a user identifier for this model.",
  schema_rejected: "The AI provider rejected the structured-output schema.",
  image_rejected: "The AI provider rejected the image input.",
  routing_unavailable: "No provider matches the required routing settings.",
} as const;
export type ProviderErrorReason = keyof typeof PROVIDER_ERROR_REASONS;

export function parseRetryAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (
    !match ||
    Number(match[3]) >
      new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
  )
    return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  // PostgreSQL timestamps can have microseconds. Round upward, never earlier.
  const fraction = /\.(\d+)(?:Z|[+-])/.exec(value)?.[1];
  const extraMillisecond = fraction && /[1-9]/.test(fraction.slice(3)) ? 1 : 0;
  return new Date(milliseconds + extraMillisecond).toISOString();
}

export class ConversationError extends Error {
  constructor(
    public readonly kind: ConversationErrorKind,
    providerStatus?: unknown,
    providerReason?: unknown,
    retryAt?: unknown,
  ) {
    super(
      kind === "provider" && validProviderStatus(providerStatus)
        ? typeof providerReason === "string" &&
          Object.hasOwn(PROVIDER_ERROR_REASONS, providerReason)
          ? `${PROVIDER_ERROR_REASONS[providerReason as ProviderErrorReason]} (OpenRouter ${providerStatus})`
          : providerErrorMessage(providerStatus)
        : {
            invalid_request:
              "Choose a PNG, JPEG, or WebP screenshot under 10 MB and a valid tone.",
            payload_too_large: "The request payload is too large.",
            invalid_output:
              "Wingr could not create a reliable reply. Please try again.",
            unusable_screenshot:
              "Wingr could not find a readable conversation to reply to. Try another screenshot.",
            provider:
              "Wingr could not analyze that screenshot right now. Please try again.",
            timeout:
              "Wingr took too long to analyze that screenshot. Please try again.",
            generation_in_progress:
              "A reply is already being generated. Please wait a moment.",
            generation_protection_unavailable:
              "Wingr could not safely start a reply right now. Please try again.",
            usage_limit:
              "You’ve reached your reply limit. Please check back later.",
            onboarding_reply_used:
              "You've already used your free onboarding reply.",
          }[kind],
    );
    if (kind === "usage_limit" || kind === "generation_in_progress")
      this.retryAt = parseRetryAt(retryAt);
    if (kind === "provider" && validProviderStatus(providerStatus))
      this.providerStatus = providerStatus;
    if (
      kind === "provider" &&
      typeof providerReason === "string" &&
      Object.hasOwn(PROVIDER_ERROR_REASONS, providerReason)
    )
      this.providerReason = providerReason as ProviderErrorReason;
  }
  readonly providerStatus?: number;
  readonly providerReason?: ProviderErrorReason;
  readonly retryAt?: string;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOT_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32;
export const MAX_CONTEXT_LENGTH = 4000;
export const MAX_REPLY_LENGTH = 500;
export const MAX_PREVIOUS_WINGR_SUGGESTIONS = 3;
const IMAGE_SIGNATURE_BASE64_LENGTH = 16;

type SupportedImageType = "png" | "jpeg" | "webp";

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
export function isReplyTone(value: unknown): value is ReplyTone {
  return REPLY_TONES.includes(value as ReplyTone);
}

function hasExpectedImageSignature(
  declaredType: SupportedImageType,
  base64Payload: string,
): boolean {
  let signature: string;
  try {
    // Twelve decoded bytes cover every supported signature. Decode only this
    // bounded prefix rather than allocating the complete image during parsing.
    signature = atob(base64Payload.slice(0, IMAGE_SIGNATURE_BASE64_LENGTH));
  } catch {
    return false;
  }

  const matches = (expected: readonly number[], offset = 0) =>
    signature.length >= offset + expected.length &&
    expected.every(
      (byte, index) => signature.charCodeAt(offset + index) === byte,
    );

  switch (declaredType) {
    case "png":
      return matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg":
      return matches([0xff, 0xd8, 0xff]);
    case "webp":
      return (
        matches([0x52, 0x49, 0x46, 0x46]) &&
        matches([0x57, 0x45, 0x42, 0x50], 8)
      );
  }
}

export function parseConversationRequest(value: unknown): ConversationRequest {
  if (
    !isObject(value) ||
    !isReplyTone(value.selectedTone) ||
    typeof value.screenshot !== "string" ||
    value.screenshot.length > MAX_SCREENSHOT_LENGTH ||
    (value.extraContext !== undefined &&
      (typeof value.extraContext !== "string" ||
        value.extraContext.length > MAX_CONTEXT_LENGTH)) ||
    (value.previousWingrSuggestions !== undefined &&
      (!Array.isArray(value.previousWingrSuggestions) ||
        value.previousWingrSuggestions.length === 0 ||
        value.previousWingrSuggestions.length >
          MAX_PREVIOUS_WINGR_SUGGESTIONS ||
        value.previousWingrSuggestions.some(
          (suggestion) => !text(suggestion, MAX_REPLY_LENGTH),
        ))) ||
    (value.isOnboardingGeneration !== undefined &&
      typeof value.isOnboardingGeneration !== "boolean")
  ) {
    throw new ConversationError("invalid_request");
  }
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value.screenshot,
    );
  if (
    !match ||
    match[2].length % 4 !== 0 ||
    (match[2].length / 4) * 3 - (match[2].match(/=+$/)?.[0].length ?? 0) >
      MAX_IMAGE_BYTES
  ) {
    throw new ConversationError("invalid_request");
  }
  if (!hasExpectedImageSignature(match[1] as SupportedImageType, match[2])) {
    throw new ConversationError("invalid_request");
  }
  return {
    screenshot: value.screenshot,
    selectedTone: value.selectedTone,
    extraContext: value.extraContext as string | undefined,
    previousWingrSuggestions: value.previousWingrSuggestions as
      | string[]
      | undefined,
    isOnboardingGeneration: value.isOnboardingGeneration as boolean | undefined,
  };
}

// The same strict contract is checked at both network boundaries. No coercion,
// invented defaults, speaker repair, or markdown/JSON recovery is performed.
export function parseConversationResult(value: unknown): ConversationResult {
  const invalid = () => {
    throw new ConversationError("invalid_output");
  };
  if (
    !isObject(value) ||
    !hasKeys(value, ["messages", "replyable", "vibeCheck", "replies"])
  )
    return invalid();
  if (
    typeof value.replyable !== "boolean" ||
    !Array.isArray(value.messages) ||
    value.messages.length > 200 ||
    !Array.isArray(value.replies) ||
    value.replies.length > 1
  )
    return invalid();
  for (const message of value.messages) {
    if (
      !isObject(message) ||
      !hasKeys(message, ["speaker", "text"]) ||
      !["ME", "THEM"].includes(message.speaker as string) ||
      !text(message.text, 12000)
    )
      return invalid();
  }
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
  } else if (
    !value.messages.length ||
    !value.vibeCheck ||
    value.replies.length !== 1
  )
    return invalid();
  return value as ConversationResult;
}

// Keep the provider schema within Gemini's supported JSON Schema subset.
// Large array bounds caused Google INVALID_ARGUMENT errors on the live route.
// Length, item-count and nonempty limits remain enforced by parseConversationResult.
const shortText = { type: "string" };
export const conversationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["messages", "replyable", "vibeCheck", "replies"],
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "text"],
        properties: {
          speaker: { type: "string", enum: ["ME", "THEM"] },
          text: { type: "string" },
        },
      },
    },
    replyable: { type: "boolean" },
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
