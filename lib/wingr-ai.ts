import { getContextNotes } from './context-notes';
import { cleanTranscriptForAi } from './transcript-cleanup';
import { extractChatTextFromImage } from './wingr-ocr';
import { hasWingrBackend, postJsonToWingrBackend } from './wingr-api';
import type {
  AnalyzeScreenshotParams,
  AnalyzeScreenshotResult,
  GenerateRepliesParams,
  OcrResult,
  ParsedConversation,
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

const FOLLOW_UPS_BY_TONE: Record<ReplyTone, [string, string]> = {
  playful: [
    'Actually, I need your honest answer on that.',
    'Leaving that there while I pretend to be patient.',
  ],
  direct: [
    'No rush, but I would like to hear what you think.',
    'I meant that. Your turn when you get a second.',
  ],
  casualSmallTalk: [
    'Anyway, what are you up to now?',
    'Also, how is your day going?',
  ],
};

const FOLLOW_UP_WHY_BY_TONE: Record<ReplyTone, string> = {
  playful: 'A light follow-up without answering your own message.',
  direct: 'Clear without pretending they already replied.',
  casualSmallTalk: 'Keeps the door open while staying low-pressure.',
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

type BackendVibeCheckPayload = Partial<VibeCheck> & {
  avoid?: string;
  bestMove?: string;
  confidence?: VibeCheck['vibeConfidence'] | number;
  energy?: string;
  interest?: VibeCheck['interestLevel'];
  oneLiner?: string;
  recommendedTone?: RecommendedReplyTone | 'casual_small_talk' | string;
  theirEnergy?: string;
  yourMove?: string;
};

type BackendAnalyzeResponse = {
  needsSpeakerConfirmation?: boolean;
  vibeCheck?: BackendVibeCheckPayload;
  avoid?: string;
  bestMove?: string;
  confidence?: VibeCheck['vibeConfidence'] | number;
  energy?: string;
  interest?: VibeCheck['interestLevel'];
  oneLiner?: string;
  recommendedTone?: RecommendedReplyTone | 'casual_small_talk' | string;
  theirEnergy?: string;
  yourMove?: string;
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
  needsSpeakerConfirmation?: boolean;
  replyBatch?: ReplyBatch;
};

type RefineVibeCheckParams = {
  extraContext?: string;
  fallbackVibeCheck?: VibeCheck;
  parsedConversation?: ParsedConversation;
  transcriptText: string;
};

function logTiming(label: string, startedAt: number, metadata?: Record<string, unknown>) {
  console.info(`[Wingr timing] ${label}`, {
    durationMs: Date.now() - startedAt,
    ...metadata,
  });
}

function normalizeBestTone(tone: unknown): RecommendedReplyTone {
  if (typeof tone !== 'string') {
    return 'playful';
  }

  const normalizedTone = tone.trim().toLowerCase().replace(/[_-]+/g, ' ');

  if (
    normalizedTone === 'casual small talk' ||
    normalizedTone === 'small talk' ||
    normalizedTone === 'casualsmalltalk'
  ) {
    return 'casualSmallTalk';
  }

  if (normalizedTone === 'direct' || normalizedTone === 'make it right') {
    return 'direct';
  }

  if (normalizedTone === 'playful' || normalizedTone === 'flirty') {
    return 'playful';
  }

  return 'playful';
}

function normalizeVibeConfidence(confidence: BackendVibeCheckPayload['confidence']): VibeCheck['vibeConfidence'] {
  if (typeof confidence === 'number') {
    if (confidence >= 0.78) {
      return 'high';
    }

    if (confidence <= 0.45) {
      return 'low';
    }

    return 'medium';
  }

  if (confidence === 'low' || confidence === 'medium' || confidence === 'high') {
    return confidence;
  }

  return MOCK_VIBE_CHECK.vibeConfidence;
}

function normalizeVibeCheck(response: BackendAnalyzeResponse): VibeCheck {
  const candidate = response.vibeCheck ?? response;
  const interestLevel = candidate.interestLevel ?? candidate.interest;
  const conversationEnergy = candidate.conversationEnergy ?? candidate.theirEnergy ?? candidate.energy;
  const bestTone = candidate.bestTone ?? candidate.recommendedTone;
  const summary = candidate.summary ?? candidate.oneLiner ?? candidate.bestMove ?? candidate.yourMove;
  const vibeConfidence = candidate.vibeConfidence ?? candidate.confidence;

  return {
    interestLevel: interestLevel ?? MOCK_VIBE_CHECK.interestLevel,
    conversationEnergy: conversationEnergy ?? MOCK_VIBE_CHECK.conversationEnergy,
    bestTone: normalizeBestTone(bestTone),
    risk: candidate.risk ?? candidate.avoid ?? MOCK_VIBE_CHECK.risk,
    summary: summary ?? MOCK_VIBE_CHECK.summary,
    targetLanguage: candidate.targetLanguage ?? MOCK_VIBE_CHECK.targetLanguage,
    vibeConfidence: normalizeVibeConfidence(vibeConfidence),
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
    .map((line) => line.replace(/^\s*(ME|THEM|UNKNOWN|You|Them|Unknown)\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join(' ');
}

function getLatestIncomingMessage(ocr: OcrResult) {
  return [...ocr.detectedMessages].reverse().find((message) => message.sender === 'them');
}

function getIncomingMessages(ocr: OcrResult) {
  return ocr.detectedMessages.filter((message) => message.sender === 'them');
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function getIncomingInterestSignals(ocr: OcrResult) {
  const incomingMessages = getIncomingMessages(ocr);
  const incomingText = incomingMessages.map((message) => message.text).join(' ');
  const normalizedIncomingText = normalizeMessageText(incomingText).toLowerCase();
  const latestIncomingMessage = getLatestIncomingMessage(ocr);
  const latestIncomingText = normalizeMessageText(latestIncomingMessage?.text ?? '').toLowerCase();

  const positiveEmojiCount = countMatches(
    incomingText,
    /(?:😍|😘|🥰|😉|❤️|💕|💖|💘|🔥|😊|😏|😂|🤣|🙈|😌|😇|🤭)/gu,
  );
  const flirtyPhraseCount = countMatches(
    normalizedIncomingText,
    /\b(cute|hot|handsome|pretty|beautiful|sexy|miss you|come over|wish you were here|you'?re funny|you are funny|you'?re sweet|you are sweet|you'?re trouble|you are trouble|date|kiss|cuddle|flirt|blush|stop it|haha stop|hehe stop)\b/gi,
  );
  const planSignalCount = countMatches(
    normalizedIncomingText,
    /\b(when are you free|when can i see you|when do i see you|let'?s meet|we should meet|come over|drinks?|coffee|dinner|tonight|tomorrow|this weekend|next week|date)\b/gi,
  );
  const questionBackCount = incomingMessages.filter((message) => /\?/.test(message.text)).length;
  const enthusiasmCount =
    countMatches(incomingText, /!/g) +
    countMatches(normalizedIncomingText, /\b(yess+|yes+|haha+|lol+|lmao+|omg|aw+|aww+)\b/gi);
  const multipleIncomingMessages = incomingMessages.length >= 3;
  const latestIsWarmShortReply =
    latestIncomingText.length > 0 &&
    latestIncomingText.length <= 24 &&
    (positiveEmojiCount > 0 || flirtyPhraseCount > 0 || enthusiasmCount > 0);
  const lowEffortSignals = incomingMessages.filter((message) =>
    /^(ok|okay|k|sure|fine|nice|cool|haha|lol|yeah|yep|no|nah)\.?$/i.test(normalizeMessageText(message.text)),
  ).length;

  return {
    enthusiasmCount,
    flirtyPhraseCount,
    latestIsWarmShortReply,
    lowEffortSignals,
    multipleIncomingMessages,
    planSignalCount,
    positiveEmojiCount,
    questionBackCount,
  };
}

function getProvisionalInterestLevel(ocr: OcrResult): VibeCheck['interestLevel'] {
  const messageCount = ocr.detectedMessages.length;
  const latestIncomingMessage = getLatestIncomingMessage(ocr);

  if (!latestIncomingMessage || (latestIncomingMessage.confidence ?? 0) < 0.45) {
    return 'Unclear';
  }

  const signals = getIncomingInterestSignals(ocr);
  const strongSignalCount =
    (signals.positiveEmojiCount >= 2 ? 1 : 0) +
    (signals.flirtyPhraseCount > 0 ? 1 : 0) +
    (signals.planSignalCount > 0 ? 1 : 0) +
    (signals.questionBackCount > 0 ? 1 : 0) +
    (signals.enthusiasmCount >= 2 ? 1 : 0) +
    (signals.latestIsWarmShortReply ? 1 : 0);

  if (strongSignalCount >= 2 || signals.planSignalCount > 0 || signals.flirtyPhraseCount >= 2) {
    return 'High';
  }

  if (
    messageCount >= 8 &&
    (latestIncomingMessage.text.length > 35 ||
      signals.positiveEmojiCount > 0 ||
      signals.questionBackCount > 0 ||
      signals.multipleIncomingMessages)
  ) {
    return 'High';
  }

  if (messageCount >= 6 && latestIncomingMessage.text.length > 18) {
    return 'Medium';
  }

  if (signals.lowEffortSignals >= Math.max(2, getIncomingMessages(ocr).length - 1)) {
    return 'Low';
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

function getAnalyzePayload(
  transcriptText: string,
  extraContext?: string,
  parsedConversation?: OcrResult['parsedConversation'],
) {
  return {
    conversation: parsedConversation?.structuredConversation,
    extraContext,
    parsedConversation,
    transcriptText: cleanTranscriptForAi(transcriptText),
  };
}

function getRepliesPayload({
  contextNotes,
  extraContext,
  parsedConversation,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: GenerateRepliesParams) {
  const structuredContext = contextNotes ?? getContextNotes(extraContext);

  return {
    conversation: parsedConversation?.structuredConversation,
    contextNotes: structuredContext,
    extraContext,
    parsedConversation,
    selectedTone,
    transcriptText: cleanTranscriptForAi(transcriptText),
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
  parsedConversation,
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
      getAnalyzePayload(transcriptText, extraContext, parsedConversation),
    );

    if (response.needsSpeakerConfirmation) {
      return {
        ...fallbackVibeCheck,
        contextWouldImproveReplyQuality: true,
        vibeConfidence: 'low',
      };
    }

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
    parsedConversation: ocr.parsedConversation,
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
  parsedConversation,
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
        parsedConversation,
        transcriptText,
        userStylePreference,
        vibeCheck,
      }),
    );

    if (response.needsSpeakerConfirmation) {
      return {};
    }

    return normalizeReplyBatch(response.replyBatch);
  }

  const localReplies = parsedConversation?.shouldGenerateDirectReply === false
    ? FOLLOW_UPS_BY_TONE
    : REPLIES_BY_TONE;
  const localWhys = parsedConversation?.shouldGenerateDirectReply === false
    ? FOLLOW_UP_WHY_BY_TONE
    : WHY_BY_TONE;

  return normalizeReplyBatch({
    [selectedTone]: localReplies[selectedTone].map((text, index) => ({
      id: `${selectedTone}-${index + 1}-${Date.now()}`,
      text,
      tone: selectedTone,
      whyItWorks: localWhys[selectedTone],
    })),
  });
}
