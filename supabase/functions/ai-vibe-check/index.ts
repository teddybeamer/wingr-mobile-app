import { handleCors } from '../_shared/cors.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { normalizeVibeCheckLanguage } from '../_shared/language.ts';
import { callOpenRouterStructured } from '../_shared/openrouter.ts';
import { buildVibeCheckPrompt, getMockVibeCheck, vibeCheckSchema } from '../_shared/prompting.ts';
import type { VibeCheck, VibeCheckRequest } from '../_shared/types.ts';

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
        task: 'vibeCheck',
      }), body.transcriptText);
    } catch (aiError) {
      console.error('ai-vibe-check fallback', aiError);
      vibeCheck = normalizeVibeCheckLanguage(getMockVibeCheck(), body.transcriptText);
    }

    return json({
      vibeCheck,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vibe check failed.';
    return error(message, 500);
  }
});
