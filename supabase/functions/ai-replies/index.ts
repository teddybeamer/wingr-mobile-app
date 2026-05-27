import { handleCors } from '../_shared/cors.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { generateReplyBatch } from '../_shared/reply-batch.ts';
import type { RepliesRequest } from '../_shared/types.ts';

Deno.serve(async (request) => {
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return error('Method not allowed.', 405);
  }

  try {
    const body = await readJson<RepliesRequest>(request);

    if (!body.transcriptText?.trim()) {
      return error('transcriptText is required.', 400);
    }

    if (!body.selectedTone) {
      return error('selectedTone is required.', 400);
    }

    if (!body.vibeCheck) {
      return error('vibeCheck is required.', 400);
    }

    const replyBatch = await generateReplyBatch(body, [body.selectedTone]);

    return json({ replyBatch });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reply generation failed.';
    return error(message, 500);
  }
});
