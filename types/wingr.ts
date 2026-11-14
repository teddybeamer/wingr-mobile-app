import type {
  ReplyTone,
  VibeCheck,
} from "../supabase/functions/_shared_v2/conversation";
import type { ProfileAngle } from "../supabase/functions/_shared_v2/opener";
export type { ProfileAngle, ReplyTone, VibeCheck };
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
// Start Conversation: the read of a profile and its openers (openers have the
// same shape as replies, so the reply cards show them unchanged).
export type StartersResult = {
  angle: ProfileAngle;
  openers: SuggestedReply[];
};
