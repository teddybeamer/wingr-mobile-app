import { handleCors } from '../_shared/cors.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { generateReplyBatch } from '../_shared/reply-batch.ts';
import { normalizeVibeCheckLanguage } from '../_shared/language.ts';
import { callOpenRouterStructured } from '../_shared/openrouter.ts';
import { buildVibeCheckPrompt, getMockVibeCheck, vibeCheckSchema } from '../_shared/prompting.ts';
import type { ReplyTone, VibeCheck, VibeCheckRequest } from '../_shared/types.ts';

const INITIAL_BATCH_TONES: ReplyTone[] = ['playful', 'direct', 'casualSmallTalk'];

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

    let vibeCheck: VibeCheck;

    try {
      vibeCheck = normalizeVibeCheckLanguage(await callOpenRouterStructured<VibeCheck>({
        prompt: buildVibeCheckPrompt(body),
        schema: vibeCheckSchema,
        schemaName: 'wingr_vibe_check',
      }), body.transcriptText);
    } catch (aiError) {
      console.error('ai-vibe-check fallback', aiError);
      vibeCheck = normalizeVibeCheckLanguage(getMockVibeCheck(), body.transcriptText);
    }

    const replyBatch = await generateReplyBatch(
      {
        selectedTone: vibeCheck.bestTone,
        transcriptText: body.transcriptText,
        vibeCheck,
        extraContext: body.extraContext,
      },
      INITIAL_BATCH_TONES,
    );

    return json({
      replyBatch,
      vibeCheck,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vibe check failed.';
    return error(message, 500);
  }
});
