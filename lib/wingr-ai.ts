import { getContextNotes } from './context-notes';
import { extractChatTextFromImage } from './wingr-ocr';
import { hasWingrBackend, postJsonToWingrBackend } from './wingr-api';
import type {
  AnalyzeScreenshotParams,
  AnalyzeScreenshotResult,
  GenerateRepliesParams,
  OcrResult,
  RecommendedReplyTone,
  ReplyBatch,
  ReplyTone,
  SuggestedReply,
  VibeCheck,
} from '../types/wingr';

const REPLIES_BY_TONE: Record<ReplyTone, [string, string]> = {
  playful: [
    "Damn... You're slowly becoming my favorite notification",
    "Haha okay, I'll take that. What are you actually up to today?",
  ],
  direct: [
    "I like talking to you. Want to actually make a plan this week?",
    "Okay, real answer then. When are you free?",
  ],
  casualSmallTalk: [
    "Haha fair. How's your day actually going?",
    "Okay, I'll take it. What have you been up to today?",
  ],
};

const WHY_BY_TONE: Record<ReplyTone, string> = {
  playful: "Playful, but doesn't over-invest.",
  direct: 'Clear and confident without chasing.',
  casualSmallTalk: 'Easy to answer and keeps the conversation moving.',
};

const MOCK_VIBE_CHECK: VibeCheck = {
  interestLevel: 'Medium',
  conversationEnergy: "They're keeping it short, but there's still room to play.",
  bestTone: 'playful',
  risk: "Don't over invest",
  summary:
    "Wingr read the vibe. There's still interest here, but the next message needs to add energy without chasing.",
  targetLanguage: 'English',
  vibeConfidence: 'medium',
  contextWouldImproveReplyQuality: false,
};

const RECOMMENDED_TONES: RecommendedReplyTone[] = ['direct', 'playful', 'casualSmallTalk'];

type BackendAnalyzeResponse = {
  vibeCheck?: VibeCheck;
  replyBatch?: ReplyBatch;
  interestLevel?: VibeCheck['interestLevel'];
  conversationEnergy?: string;
  bestTone?: string;
  risk?: string;
  summary?: string;
  targetLanguage?: string;
  vibeConfidence?: VibeCheck['vibeConfidence'];
  contextWouldImproveReplyQuality?: boolean;
};

type BackendRepliesResponse = {
  replyBatch?: ReplyBatch;
};

type RefineVibeCheckParams = {
  extraContext?: string;
  fallbackVibeCheck?: VibeCheck;
  transcriptText: string;
};

function logTiming(label: string, startedAt: number, metadata?: Record<string, unknown>) {
  console.info(`[Wingr timing] ${label}`, {
    durationMs: Date.now() - startedAt,
    ...metadata,
  });
}

function normalizeBestTone(tone: unknown): RecommendedReplyTone {
  if (tone === 'casual_small_talk') {
    return 'casualSmallTalk';
  }

  if (RECOMMENDED_TONES.includes(tone as RecommendedReplyTone)) {
    return tone as RecommendedReplyTone;
  }

  return 'playful';
}

function normalizeVibeCheck(response: BackendAnalyzeResponse): VibeCheck {
  const candidate = response.vibeCheck ?? response;

  return {
    interestLevel: candidate.interestLevel ?? MOCK_VIBE_CHECK.interestLevel,
    conversationEnergy: candidate.conversationEnergy ?? MOCK_VIBE_CHECK.conversationEnergy,
    bestTone: normalizeBestTone(candidate.bestTone),
    risk: candidate.risk ?? MOCK_VIBE_CHECK.risk,
    summary: candidate.summary ?? MOCK_VIBE_CHECK.summary,
    targetLanguage: candidate.targetLanguage ?? MOCK_VIBE_CHECK.targetLanguage,
    vibeConfidence: candidate.vibeConfidence ?? MOCK_VIBE_CHECK.vibeConfidence,
    contextWouldImproveReplyQuality:
      candidate.contextWouldImproveReplyQuality ??
      MOCK_VIBE_CHECK.contextWouldImproveReplyQuality,
  };
}

function normalizeMessageText(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}

function getMeaningfulTranscriptText(transcriptText: string) {
  return transcriptText
    .split('\n')
    .map((line) => line.replace(/^\s*(You|Them|Unknown)\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join(' ');
}

function getLatestIncomingMessage(ocr: OcrResult) {
  return [...ocr.detectedMessages].reverse().find((message) => message.sender === 'them');
}

function getProvisionalInterestLevel(ocr: OcrResult): VibeCheck['interestLevel'] {
  const messageCount = ocr.detectedMessages.length;
  const latestIncomingMessage = getLatestIncomingMessage(ocr);

  if (!latestIncomingMessage || (latestIncomingMessage.confidence ?? 0) < 0.45) {
    return 'Unclear';
  }

  if (messageCount >= 8 && latestIncomingMessage.text.length > 35) {
    return 'High';
  }

  if (messageCount >= 6 && latestIncomingMessage.text.length > 18) {
    return 'Medium';
  }

  return 'Medium';
}

function getProvisionalTone(ocr: OcrResult): RecommendedReplyTone {
  const latestIncomingMessage = getLatestIncomingMessage(ocr);
  const latestIncomingText = normalizeMessageText(latestIncomingMessage?.text ?? '').toLowerCase();

  if (/\b(when|where|plan|free|meet|date|tonight|tomorrow)\b/.test(latestIncomingText)) {
    return 'direct';
  }

  if (latestIncomingText.length < 18) {
    return 'playful';
  }

  return 'casualSmallTalk';
}

export function buildProvisionalVibeCheck(ocr: OcrResult): VibeCheck {
  const meaningfulText = getMeaningfulTranscriptText(ocr.transcriptText);
  const meaningfulCharacterCount = meaningfulText.replace(/\s/g, '').length;
  const latestIncomingMessage = getLatestIncomingMessage(ocr);
  const latestIncomingText = normalizeMessageText(latestIncomingMessage?.text ?? '');
  const lowConfidence = (ocr.confidence ?? 0) < 0.45 || meaningfulCharacterCount < 28;
  const shortLatestReply = latestIncomingText.length > 0 && latestIncomingText.length < 18;
  const bestTone = getProvisionalTone(ocr);

  if (lowConfidence) {
    return {
      interestLevel: 'Unclear',
      conversationEnergy: 'There is enough signal to start, but part of the chat may need a closer read.',
      bestTone,
      risk: 'Avoid guessing too much',
      summary: 'Wingr has a quick first read. The AI pass is checking the details now.',
      targetLanguage: 'English',
      vibeConfidence: 'low',
      contextWouldImproveReplyQuality: true,
    };
  }

  if (shortLatestReply) {
    return {
      interestLevel: getProvisionalInterestLevel(ocr),
      conversationEnergy: "They're keeping it short, but there's still room to play.",
      bestTone,
      risk: "Don't over invest",
      summary: 'Quick read: there is something to work with, but the next reply should add energy.',
      targetLanguage: 'English',
      vibeConfidence: 'medium',
      contextWouldImproveReplyQuality: false,
    };
  }

  return {
    interestLevel: getProvisionalInterestLevel(ocr),
    conversationEnergy: 'There is some interest here, but the chat needs a sharper reply to keep momentum.',
    bestTone,
    risk: 'Keep it clear without chasing',
    summary: 'Quick read: the conversation has enough signal for a confident next move.',
    targetLanguage: 'English',
    vibeConfidence: 'medium',
    contextWouldImproveReplyQuality: false,
  };
}

function getAnalyzePayload(transcriptText: string, extraContext?: string) {
  return {
    extraContext,
    transcriptText,
  };
}

function getRepliesPayload({
  contextNotes,
  extraContext,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: GenerateRepliesParams) {
  const structuredContext = contextNotes ?? getContextNotes(extraContext);

  return {
    contextNotes: structuredContext,
    extraContext,
    selectedTone,
    transcriptText,
    userStylePreference,
    vibeCheck,
  };
}

function normalizeReplyBatch(replyBatch?: ReplyBatch): ReplyBatch {
  return {
    casualSmallTalk: replyBatch?.casualSmallTalk?.slice(0, 2),
    direct: replyBatch?.direct?.slice(0, 2),
    playful: replyBatch?.playful?.slice(0, 2),
  };
}

export async function extractScreenshotConversation(screenshotUri: string) {
  const startedAt = Date.now();
  const ocr = await extractChatTextFromImage(screenshotUri);

  logTiming('ocr', startedAt, {
    detectedMessages: ocr.detectedMessages.length,
    transcriptLength: ocr.transcriptText.length,
  });

  return ocr;
}

export async function refineVibeCheck({
  extraContext,
  fallbackVibeCheck = MOCK_VIBE_CHECK,
  transcriptText,
}: RefineVibeCheckParams): Promise<VibeCheck> {
  if (!hasWingrBackend()) {
    console.info('[Wingr timing] vibe-check-ai', { result: 'fallback-no-backend' });
    return fallbackVibeCheck;
  }

  const startedAt = Date.now();

  try {
    const response = await postJsonToWingrBackend<BackendAnalyzeResponse>(
      '/ai-vibe-check',
      getAnalyzePayload(transcriptText, extraContext),
    );
    const vibeCheck = normalizeVibeCheck(response);

    logTiming('vibe-check-ai', startedAt, { result: 'refined' });

    return vibeCheck;
  } catch (error) {
    logTiming('vibe-check-ai', startedAt, {
      result: 'fallback',
      reason: error instanceof Error ? error.message : 'unknown',
    });

    return fallbackVibeCheck;
  }
}

export async function analyzeScreenshot({
  extraContext,
  screenshotUri,
}: AnalyzeScreenshotParams): Promise<AnalyzeScreenshotResult> {
  const ocr = await extractScreenshotConversation(screenshotUri);
  const provisionalVibeCheck = buildProvisionalVibeCheck(ocr);
  const vibeCheck = await refineVibeCheck({
    extraContext,
    fallbackVibeCheck: provisionalVibeCheck,
    transcriptText: ocr.transcriptText,
  });

  return {
    ocr,
    replyBatch: {},
    transcriptText: ocr.transcriptText,
    vibeCheck,
  };
}

export async function generateReplies({
  extraContext,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: GenerateRepliesParams): Promise<ReplyBatch> {
  if (hasWingrBackend()) {
    const response = await postJsonToWingrBackend<BackendRepliesResponse>(
      '/ai-replies',
      getRepliesPayload({
        contextNotes: getContextNotes(extraContext),
        extraContext,
        screenshotUri: null,
        selectedTone,
        transcriptText,
        userStylePreference,
        vibeCheck,
      }),
    );

    return normalizeReplyBatch(response.replyBatch);
  }

  return normalizeReplyBatch({
    [selectedTone]: REPLIES_BY_TONE[selectedTone].map((text, index) => ({
      id: `${selectedTone}-${index + 1}-${Date.now()}`,
      text,
      tone: selectedTone,
      whyItWorks: WHY_BY_TONE[selectedTone],
    })),
  });
}
