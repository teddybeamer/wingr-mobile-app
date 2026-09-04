import { handleCors } from '../_shared/cors.ts';
import {
  CONVERSATION_TURN_STATE_VERSION,
  getConversationTurnState,
} from '../_shared/conversation-turn-state.ts';
import { error, json, readJson } from '../_shared/http.ts';
import { generateReplyBatch } from '../_shared/reply-batch.ts';
import { needsSpeakerConfirmation } from '../_shared/speaker-attribution.ts';
import type { RepliesRequest } from '../_shared/types.ts';

Deno.serve(async (request) => {
  const startedAt = Date.now();
  let selectedTone = 'unknown';
  let finalOutcome = 'error';

  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return error('Method not allowed.', 405);
  }

  try {
    const body = await readJson<RepliesRequest>(request);
    selectedTone = body.selectedTone ?? 'missing';
    console.info('[Wingr AI] Reply input state', {
      hasParsedConversation: Boolean(body.parsedConversation),
      implementationVersion: CONVERSATION_TURN_STATE_VERSION,
      selectedTone,
      turnState: getConversationTurnState(body.parsedConversation),
    });

    if (!body.transcriptText?.trim()) {
      return error('transcriptText is required.', 400);
    }

    if (!body.selectedTone) {
      return error('selectedTone is required.', 400);
    }

    if (!body.vibeCheck) {
      return error('vibeCheck is required.', 400);
    }

    if (needsSpeakerConfirmation(body.parsedConversation)) {
      finalOutcome = 'speakerConfirmation';
      console.warn('[Wingr AI] Reply generation diagnostic', {
        event: 'needs_speaker_confirmation_empty_batch',
        hasParsedConversation: Boolean(body.parsedConversation),
        selectedTone,
        turnState: getConversationTurnState(body.parsedConversation),
      });
      return json({ needsSpeakerConfirmation: true });
    }

    const { replyBatch, telemetry } = await generateReplyBatch(body, [body.selectedTone]);
    finalOutcome = telemetry.finalOutcome;
    console.info('[Wingr AI] Reply pipeline result', {
      answerability: telemetry.answerability,
      emergencyGeneration: telemetry.emergencyGeneration,
      event: 'reply_pipeline_result',
      finalOutcome: telemetry.finalOutcome,
      generationId: telemetry.generationId,
      initialGeneration: telemetry.initialGeneration,
      repairGeneration: telemetry.repairGeneration,
      returnedStage: telemetry.returnedStage,
      stageTimings: telemetry.stageTimings,
      terminalFallback: telemetry.terminalFallback,
      totalDurationMs: telemetry.totalDurationMs,
      validationRejections: telemetry.validationRejections,
    });

    return json({ replyBatch });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reply generation failed.';
    return error(message, 500);
  } finally {
    console.info('[Wingr AI] ai-replies request timing', {
      durationMs: Date.now() - startedAt,
      finalOutcome,
      selectedTone,
    });
  }
});
