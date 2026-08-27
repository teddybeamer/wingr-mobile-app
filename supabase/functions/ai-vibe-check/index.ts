import { handleCors } from '../_shared/cors.ts';
import {
  CONVERSATION_TURN_STATE_VERSION,
  getConversationTurnState,
} from '../_shared/conversation-turn-state.ts';
import { error, json, readJson } from '../_shared/http.ts';
import {
  inferTranscriptLanguage,
  resolveConversationLanguage,
} from '../_shared/language.ts';
import { callOpenRouterStructured } from '../_shared/openrouter.ts';
import { withSafeVibeCheckTranscript } from '../_shared/prompt-budget.ts';
import {
  buildGeminiVibeCheckPrompt,
  geminiVibeCheckSchema,
  getMockGeminiVibeCheck,
} from '../_shared/prompting.ts';
import { needsSpeakerConfirmation } from '../_shared/speaker-attribution.ts';
import type { GeminiVibeCheck, VibeCheckRequest } from '../_shared/types.ts';

function normalizeTargetLanguage(
  targetLanguage: string | undefined,
  transcriptText: string,
  parsedConversation: VibeCheckRequest['parsedConversation'],
) {
  return (
    resolveConversationLanguage(parsedConversation) ??
    targetLanguage?.trim() ??
    inferTranscriptLanguage(transcriptText) ??
    'English'
  );
}

Deno.serve(async (request) => {
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return error('Method not allowed.', 405);
  }

  try {
    const body = await readJson<VibeCheckRequest>(request);

    console.info('[Wingr AI] Vibe check input state', {
      hasParsedConversation: Boolean(body.parsedConversation),
      implementationVersion: CONVERSATION_TURN_STATE_VERSION,
      turnState: getConversationTurnState(body.parsedConversation),
    });

    if (!body.transcriptText?.trim()) {
      return error('transcriptText is required.', 400);
    }

    if (needsSpeakerConfirmation(body.parsedConversation)) {
      return json({ needsSpeakerConfirmation: true });
    }

    let vibeCheck: GeminiVibeCheck;
    const safeBody = withSafeVibeCheckTranscript(body);

    try {
      const rawVibeCheck = await callOpenRouterStructured<GeminiVibeCheck>({
        prompt: buildGeminiVibeCheckPrompt(safeBody),
        schema: geminiVibeCheckSchema,
        schemaName: 'wingr_vibe_check_gemini_flash_lite',
        task: 'vibeCheck',
      });

      vibeCheck = {
        ...rawVibeCheck,
        targetLanguage: normalizeTargetLanguage(
          rawVibeCheck.targetLanguage,
          safeBody.transcriptText,
          safeBody.parsedConversation,
        ),
      };
      console.info('[Wingr AI] Vibe check output state', {
        implementationVersion: CONVERSATION_TURN_STATE_VERSION,
        outputTurnStateValidation: 'not_implemented',
        result: 'success',
      });
    } catch {
      // Do not log provider errors: upstream error details can contain
      // request-derived conversation content.
      console.error('ai-vibe-check falling back to the local mock response.');
      console.warn('[Wingr AI] Vibecheck provider: fallback mock', {
        endpointType: 'local fallback',
        model: 'mock',
        result: 'fallback',
        task: 'vibeCheck',
      });
      const mockVibeCheck = getMockGeminiVibeCheck();
      vibeCheck = {
        ...mockVibeCheck,
        targetLanguage: normalizeTargetLanguage(
          mockVibeCheck.targetLanguage,
          safeBody.transcriptText,
          safeBody.parsedConversation,
        ),
      };
      console.info('[Wingr AI] Vibe check output state', {
        implementationVersion: CONVERSATION_TURN_STATE_VERSION,
        outputTurnStateValidation: 'not_implemented',
        result: 'fallback',
      });
    }

    return json({
      vibeCheck,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vibe check failed.';
    return error(message, 500);
  }
});
