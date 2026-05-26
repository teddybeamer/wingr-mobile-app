import { handleCors } from '../_shared/cors.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { callOpenRouterStructured } from '../_shared/openrouter.ts';
import { buildRepliesPrompt, getMockReplies, repliesSchema } from '../_shared/prompting.ts';
import { getOwnershipSafeReplies } from '../_shared/reply-ownership.ts';
import type { RepliesRequest, SuggestedReply } from '../_shared/types.ts';

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

    let replies: SuggestedReply[];

    try {
      const result = await callOpenRouterStructured<{ replies: SuggestedReply[] }>({
        prompt: buildRepliesPrompt(body),
        schema: repliesSchema,
        schemaName: 'wingr_reply_suggestions',
      });
      replies = getOwnershipSafeReplies(result.replies, body);
    } catch (aiError) {
      console.error('ai-replies fallback', aiError);
      replies = getOwnershipSafeReplies(getMockReplies(body.selectedTone), body);
    }

    return json({ replies });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reply generation failed.';
    return error(message, 500);
  }
});
