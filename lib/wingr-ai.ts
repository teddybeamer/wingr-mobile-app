import { getContextNotes } from './context-notes';
import { extractChatTextFromImage } from './wingr-ocr';
import { hasWingrBackend, postJsonToWingrBackend } from './wingr-api';
import type {
  AnalyzeScreenshotParams,
  AnalyzeScreenshotResult,
  GenerateRepliesParams,
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
  conversationEnergy: 'Dry but recoverable',
  bestTone: 'playful',
  risk: "Don't over invest",
  summary:
    "Wingr read the vibe. There's still interest here, but the next message needs to add energy without chasing.",
  targetLanguage: 'English',
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
};

type BackendRepliesResponse = {
  replyBatch?: ReplyBatch;
};

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

function getMockReplyBatch(): ReplyBatch {
  return {
    casualSmallTalk: REPLIES_BY_TONE.casualSmallTalk.map((text, index) => ({
      id: `casualSmallTalk-${index + 1}`,
      text,
      tone: 'casualSmallTalk',
      whyItWorks: WHY_BY_TONE.casualSmallTalk,
    })),
    direct: REPLIES_BY_TONE.direct.map((text, index) => ({
      id: `direct-${index + 1}`,
      text,
      tone: 'direct',
      whyItWorks: WHY_BY_TONE.direct,
    })),
    playful: REPLIES_BY_TONE.playful.map((text, index) => ({
      id: `playful-${index + 1}`,
      text,
      tone: 'playful',
      whyItWorks: WHY_BY_TONE.playful,
    })),
  };
}

export async function analyzeScreenshot({
  extraContext,
  screenshotUri,
}: AnalyzeScreenshotParams): Promise<AnalyzeScreenshotResult> {
  const ocr = await extractChatTextFromImage(screenshotUri);

  if (!hasWingrBackend()) {
    return {
      ocr,
      replyBatch: getMockReplyBatch(),
      transcriptText: ocr.transcriptText,
      vibeCheck: MOCK_VIBE_CHECK,
    };
  }

  try {
    const response = await postJsonToWingrBackend<BackendAnalyzeResponse>(
      '/ai-vibe-check',
      getAnalyzePayload(ocr.transcriptText, extraContext),
    );

    return {
      ocr,
      replyBatch: normalizeReplyBatch(response.replyBatch),
      transcriptText: ocr.transcriptText,
      vibeCheck: normalizeVibeCheck(response),
    };
  } catch {
    return {
      ocr,
      replyBatch: getMockReplyBatch(),
      transcriptText: ocr.transcriptText,
      vibeCheck: MOCK_VIBE_CHECK,
    };
  }
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
