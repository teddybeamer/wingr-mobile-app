// Offline voice checks for user-facing vibe check text. Used by tests and the
// benchmarks only; it never runs in the Edge Function and never changes a response.
// "ME"/"THEM" are internal sender labels and must not reach the user.

export const VIBE_TEXT_FIELDS = ["conversationEnergy", "risk", "summary"] as const;
export type VibeTextField = (typeof VIBE_TEXT_FIELDS)[number];
export type VoiceIssue = "internal_label" | "report_opening";

// Upper-case tokens only: lower-case "me" is ordinary English.
const INTERNAL_LABEL = /\b(ME|THEM)\b/;
const REPORT_OPENING =
  /^\s*(both(?! of you)\b|the conversation (shows|suggests|is|has)\b|the user\b|me and them\b|the other person\b)/i;
const SECOND_PERSON = /\byou(?:r|rs|rself|'re|'ve|'ll|'d)?\b/i;

export function voiceIssues(text: string): VoiceIssue[] {
  const issues: VoiceIssue[] = [];
  if (INTERNAL_LABEL.test(text)) issues.push("internal_label");
  if (REPORT_OPENING.test(text)) issues.push("report_opening");
  return issues;
}

/** Issues per field of a vibe check; fields without issues are omitted. */
export function lintVibeCheck(vibe: Partial<Record<VibeTextField, unknown>> | null) {
  const result: Partial<Record<VibeTextField, VoiceIssue[]>> = {};
  if (!vibe) return result;
  for (const field of VIBE_TEXT_FIELDS) {
    const value = vibe[field];
    if (typeof value !== "string") continue;
    const issues = voiceIssues(value);
    if (issues.length) result[field] = issues;
  }
  return result;
}

/** Informational only (never a rule): does the summary address the reader directly? */
export function addressesReader(summary: string) {
  return SECOND_PERSON.test(summary);
}
