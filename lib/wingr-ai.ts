import { getContextNotes } from './context-notes';
import { extractChatTextFromImage } from './wingr-ocr';
import { hasWingrBackend, postJsonToWingrBackend } from './wingr-api';
import type {
  AnalyzeScreenshotParams,
  AnalyzeScreenshotResult,
  GenerateRepliesParams,
  RecommendedReplyTone,
  ReplyTone,
  SuggestedReply,
  VibeCheck,
} from '../types/wingr';

const REPLIES_BY_TONE: Record<ReplyTone, [string, string]> = {
  sound_more_like_me: [
    "Haha okay, I'll give you that one. What are you actually up to today?",
    "Okay, fair. I'll allow it, but only because the energy is improving.",
  ],
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
  sound_more_like_me: 'Uses your saved texting style without adding extra pressure.',
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
};

const RECOMMENDED_TONES: RecommendedReplyTone[] = ['direct', 'playful', 'casualSmallTalk'];

type BackendAnalyzeResponse = {
  vibeCheck?: VibeCheck;
  interestLevel?: VibeCheck['interestLevel'];
  conversationEnergy?: string;
  bestTone?: string;
  risk?: string;
  summary?: string;
};

type BackendRepliesResponse = {
  replies?: SuggestedReply[];
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

export async function analyzeScreenshot({
  extraContext,
  screenshotUri,
}: AnalyzeScreenshotParams): Promise<AnalyzeScreenshotResult> {
  const ocr = await extractChatTextFromImage(screenshotUri);

  if (!hasWingrBackend()) {
    return {
      ocr,
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
      transcriptText: ocr.transcriptText,
      vibeCheck: normalizeVibeCheck(response),
    };
  } catch {
    return {
      ocr,
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
}: GenerateRepliesParams): Promise<SuggestedReply[]> {
  if (hasWingrBackend()) {
    try {
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

      if (response.replies?.length === 2) {
        return response.replies.map((reply, index) => ({
          id: reply.id || `${selectedTone}-${index + 1}`,
          text: reply.text,
          tone: reply.tone,
        }));
      }
    } catch {
      // Fall through to mock replies so the MVP remains usable while the backend is wired.
    }
  }

  const replies = REPLIES_BY_TONE[selectedTone];
  const styleHint =
    selectedTone === 'sound_more_like_me' && userStylePreference?.howTheyText
      ? ` Sounds like you: ${userStylePreference.howTheyText}.`
      : '';

  return replies.map((text, index) => ({
    id: `${selectedTone}-${index + 1}-${Date.now()}`,
    tone: selectedTone,
    text,
    whyItWorks: `${WHY_BY_TONE[selectedTone]}${styleHint}`,
  }));
}
