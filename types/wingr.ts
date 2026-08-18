export type ReplyTone =
  | 'playful'
  | 'direct'
  | 'casualSmallTalk';

export type RecommendedReplyTone = 'direct' | 'playful' | 'casualSmallTalk';

export type ToneOption = {
  emoji: string;
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

export type MessageSender = 'me' | 'them' | 'unknown';
export type MessageSpeaker = 'user' | 'other' | 'unknown';
export type MessageXPosition = 'left' | 'right' | 'center';

export type StructuredConversationMessage = {
  speaker: MessageSender;
  text: string;
};

export type MessageBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MessageLanguageEvidence = {
  tag: string;
  lineCount: number;
};

export type DetectedMessage = {
  id: string;
  speaker: MessageSpeaker;
  sender: MessageSender;
  text: string;
  confidence: number;
  xPosition: MessageXPosition;
  boundingBox: MessageBoundingBox;
  languageEvidence?: MessageLanguageEvidence[];
};

export type ParsedConversation = {
  messages: DetectedMessage[];
  structuredConversation: StructuredConversationMessage[];
  latestMessageSender: MessageSender;
  shouldGenerateDirectReply: boolean;
  speakerAttributionConfidence: number;
  speakerAttributionResolved: boolean;
};

export type OcrResult = {
  transcriptText: string;
  detectedMessages: DetectedMessage[];
  parsedConversation: ParsedConversation;
  rawText?: string;
  source: 'backend' | 'onDevice';
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
  parsedConversation?: ParsedConversation;
  extraContext?: string;
  contextNotes?: ContextNotes;
  userStylePreference?: UserStylePreference;
};
