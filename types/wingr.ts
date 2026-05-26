import type { Icon as SolarIcon } from '@solar-icons/react-native/lib/index';

export type ReplyTone =
  | 'sound_more_like_me'
  | 'playful'
  | 'direct'
  | 'casualSmallTalk';

export type RecommendedReplyTone = 'direct' | 'playful' | 'casualSmallTalk';

export type ToneOption = {
  icon: SolarIcon;
  value: ReplyTone;
  label: string;
};

export type VibeCheck = {
  interestLevel: 'Low' | 'Medium' | 'High' | 'Unclear';
  conversationEnergy: string;
  bestTone: RecommendedReplyTone;
  risk: string;
  summary: string;
};

export type SuggestedReply = {
  id: string;
  tone: ReplyTone;
  text: string;
  whyItWorks?: string;
};

export type UserStylePreference = {
  howTheyText: string;
};

export type OcrResult = {
  transcriptText: string;
  source: 'backend' | 'mock';
  confidence?: number;
};

export type AnalyzeScreenshotParams = {
  screenshotUri: string;
  extraContext?: string;
};

export type AnalyzeScreenshotResult = {
  transcriptText: string;
  vibeCheck: VibeCheck;
  ocr: OcrResult;
};

export type GenerateRepliesParams = {
  vibeCheck: VibeCheck;
  selectedTone: ReplyTone;
  screenshotUri: string | null;
  transcriptText: string;
  extraContext?: string;
  userStylePreference?: UserStylePreference;
};
