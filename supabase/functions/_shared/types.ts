export type RecommendedReplyTone = 'direct' | 'playful' | 'casualSmallTalk';

export type ReplyTone =
  | 'playful'
  | 'direct'
  | 'casualSmallTalk';

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
};

export type ReplyBatch = Partial<Record<ReplyTone, SuggestedReply[]>>;

export type ContextNotes = {
  userFacts: string[];
  themFacts: string[];
  situationNotes: string[];
  replyInstruction: string[];
};

export type VibeCheckRequest = {
  transcriptText: string;
  extraContext?: string;
};

export type RepliesRequest = {
  transcriptText: string;
  selectedTone: ReplyTone;
  vibeCheck: VibeCheck;
  extraContext?: string;
  contextNotes?: ContextNotes;
  userStylePreference?: {
    howTheyText: string;
  };
};
