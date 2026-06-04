import { handleCors } from '../_shared/cors.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { inferTranscriptLanguage } from '../_shared/language.ts';
import { callOpenRouterStructured } from '../_shared/openrouter.ts';
import {
  buildGeminiVibeCheckPrompt,
  geminiVibeCheckSchema,
  getMockGeminiVibeCheck,
} from '../_shared/prompting.ts';
import type { GeminiVibeCheck, VibeCheckRequest } from '../_shared/types.ts';

function normalizeTargetLanguage(targetLanguage: string | undefined, transcriptText: string) {
  return targetLanguage?.trim() || inferTranscriptLanguage(transcriptText) || 'English';
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

    if (!body.transcriptText?.trim()) {
      return error('transcriptText is required.', 400);
    }

    let vibeCheck: GeminiVibeCheck;

    try {
      const rawVibeCheck = await callOpenRouterStructured<GeminiVibeCheck>({
        prompt: buildGeminiVibeCheckPrompt(body),
        schema: geminiVibeCheckSchema,
        schemaName: 'wingr_vibe_check_gemini_flash_lite',
        task: 'vibeCheck',
      });

      vibeCheck = {
        ...rawVibeCheck,
        targetLanguage: normalizeTargetLanguage(rawVibeCheck.targetLanguage, body.transcriptText),
      };
    } catch (aiError) {
      console.error('ai-vibe-check fallback', aiError);
      const mockVibeCheck = getMockGeminiVibeCheck();
      vibeCheck = {
        ...mockVibeCheck,
        targetLanguage: normalizeTargetLanguage(mockVibeCheck.targetLanguage, body.transcriptText),
      };
    }

    return json({
      vibeCheck,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vibe check failed.';
    return error(message, 500);
  }
});
