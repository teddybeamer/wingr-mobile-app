import type {
  ConversationMessage,
  ReplyTone,
  VibeCheck,
} from "../supabase/functions/_shared/conversation";
export type { ConversationMessage, ReplyTone, VibeCheck };
export type RecommendedReplyTone = ReplyTone;
export type ToneOption = { emoji: string; value: ReplyTone; label: string };
export type SuggestedReply = {
  id: string;
  tone: ReplyTone;
  text: string;
  whyItWorks?: string;
};
export type AnalyzeScreenshotResult = {
  messages: ConversationMessage[];
  vibeCheck: VibeCheck;
  replies: SuggestedReply[];
};
