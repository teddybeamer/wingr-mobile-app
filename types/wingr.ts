import type { Icon as SolarIcon } from '@solar-icons/react-native/lib/index';

export type ReplyTone =
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
  targetLanguage?: string;
  vibeConfidence?: 'low' | 'medium' | 'high';
  contextWouldImproveReplyQuality?: boolean;
};

export type SuggestedReply = {
  id: string;
  tone: ReplyTone;
  text: string;
  whyItWorks?: string;
};

export type ReplyBatch = Partial<Record<ReplyTone, SuggestedReply[]>>;

export type UserStylePreference = {
  howTheyText: string;
};

export type ContextNotes = {
  userFacts: string[];
  themFacts: string[];
  situationNotes: string[];
  replyInstruction: string[];
};

export type DetectedMessage = {
  id: string;
  sender: 'you' | 'them' | 'unknown';
  text: string;
  confidence?: number;
};

export type OcrResult = {
  transcriptText: string;
  detectedMessages: DetectedMessage[];
  rawText?: string;
  source: 'onDevice';
  confidence?: number;
};

export type AnalyzeScreenshotParams = {
  screenshotUri: string;
  extraContext?: string;
};

export type AnalyzeScreenshotResult = {
  transcriptText: string;
  vibeCheck: VibeCheck;
  replyBatch: ReplyBatch;
  ocr: OcrResult;
};

export type GenerateRepliesParams = {
  vibeCheck: VibeCheck;
  selectedTone: ReplyTone;
  screenshotUri: string | null;
  transcriptText: string;
  extraContext?: string;
  contextNotes?: ContextNotes;
  userStylePreference?: UserStylePreference;
};
