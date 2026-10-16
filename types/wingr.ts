import type {
  ReplyTone,
  VibeCheck,
} from "../supabase/functions/_shared_v2/conversation";
export type { ReplyTone, VibeCheck };
export type RecommendedReplyTone = ReplyTone;
export type ToneOption = { emoji: string; value: ReplyTone; label: string };
export type SuggestedReply = {
  id: string;
  tone: ReplyTone;
  text: string;
  whyItWorks?: string;
};
export type AnalyzeScreenshotResult = {
  vibeCheck: VibeCheck;
  replies: SuggestedReply[];
};
