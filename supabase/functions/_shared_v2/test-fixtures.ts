export const input = {
  screenshot: "data:image/png;base64,iVBORw0KGgo=",
  selectedTone: "playful" as const,
};
export const result = {
  replyable: true,
  vibeCheck: {
    interestLevel: "High" as const,
    conversationEnergy: "De er med på planen.",
    bestTone: "direct" as const,
    risk: "Hold det enkelt.",
    summary: "Foreslå et sted.",
  },
  replies: ["Skal vi finde en café ved søerne?"],
};

export const providerResult = { ...result, failureReason: null };

export function asProviderResult(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("replyable" in value) ||
    "failureReason" in value
  )
    return value;
  return {
    ...value,
    failureReason:
      (value as { replyable?: unknown }).replyable === true ? null : "unknown",
  };
}
