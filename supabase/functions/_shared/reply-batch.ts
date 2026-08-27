import {
  normalizeVibeCheckLanguage,
  repliesLookWrongLanguage,
  resolveConversationLanguage,
} from './language.ts';
import { callOpenRouterStructured } from './openrouter.ts';
import { withSafeReplyTranscript } from './prompt-budget.ts';
import {
  buildReplyBatchPrompt,
  buildReplyGroundingRepairPrompt,
  buildReplyLanguageRepairPrompt,
  createReplyBatchSchema,
  getMockReplyBatch,
} from './prompting.ts';
import {
  getOwnershipCheckedReplies,
  getReplyOwnershipValidationTrace,
  getOwnershipSafeReplies,
} from './reply-ownership.ts';
import type { ReplyBatch, RepliesRequest, ReplyTone } from './types.ts';

type ReplyBatchResult = {
  replyBatch?: ReplyBatch;
};

type ReplyGenerationTiming = {
  attemptCount: number;
  durationMs: number;
};

export type ReplyGenerationTelemetry = {
  finalOutcome: 'success' | 'fallback' | 'error';
  groundingRepair: ReplyGenerationTiming & {
    reason: 'not_triggered' | 'no_ownership_safe_reply';
    triggered: boolean;
  };
  initialGeneration: ReplyGenerationTiming;
  languageRepair: ReplyGenerationTiming & {
    triggered: boolean;
  };
  ownershipValidation: 'accepted' | 'not_run' | 'rejected';
  ownershipValidationTrace: {
    initial: ReturnType<typeof getReplyOwnershipValidationTrace> | null;
    repair: ReturnType<typeof getReplyOwnershipValidationTrace> | null;
  };
};

export type ReplyBatchGenerationResult = {
  replyBatch: ReplyBatch;
  telemetry: ReplyGenerationTelemetry;
};

function logReplyGenerationTiming(
  telemetry: ReplyGenerationTelemetry,
  selectedTones: ReplyTone[],
) {
  console.info('[Wingr AI] Reply generation timing', {
    ...telemetry,
    selectedTone: selectedTones.length === 1 ? selectedTones[0] : 'multiple',
  });
}

function getFlattenedReplies(replyBatch: ReplyBatch) {
  return Object.values(replyBatch).flatMap((replies) => replies ?? []);
}

function getFilteredReplyBatch(replyBatch: ReplyBatch, request: RepliesRequest, selectedTones: ReplyTone[]) {
  return Object.fromEntries(
    selectedTones.map((tone) => [
      tone,
      getOwnershipSafeReplies(replyBatch[tone] ?? [], { ...request, selectedTone: tone }),
    ]),
  ) as ReplyBatch;
}

function getCheckedReplyBatch(replyBatch: ReplyBatch, request: RepliesRequest, selectedTones: ReplyTone[]) {
  return Object.fromEntries(
    selectedTones.map((tone) => [
      tone,
      getOwnershipCheckedReplies(replyBatch[tone] ?? [], { ...request, selectedTone: tone }),
    ]),
  ) as ReplyBatch;
}

function hasMissingReply(replyBatch: ReplyBatch, selectedTones: ReplyTone[]) {
  return selectedTones.some((tone) => (replyBatch[tone] ?? []).length === 0);
}

function hasWrongLanguageInBatch(replyBatch: ReplyBatch, request: RepliesRequest) {
  return Object.values(replyBatch).some(
    (replies) => replies && repliesLookWrongLanguage(replies, request.vibeCheck),
  );
}

function getMockFollowUpReplies(selectedTone: ReplyTone) {
  const map: Record<ReplyTone, string> = {
    playful: 'Actually, I need your honest answer on that.',
    direct: 'No rush, but I would like to hear what you think.',
    casualSmallTalk: 'Anyway, what are you up to now?',
  };

  return [{
    id: `${selectedTone}-follow-up-1`,
    text: map[selectedTone],
    tone: selectedTone,
  }];
}

function getMockBatchForRequest(request: RepliesRequest, selectedTones: ReplyTone[]) {
  if (request.parsedConversation?.shouldGenerateDirectReply === false) {
    return Object.fromEntries(
      selectedTones.map((tone) => [tone, getMockFollowUpReplies(tone)]),
    ) as ReplyBatch;
  }

  return getMockReplyBatch(selectedTones);
}

export async function generateReplyBatch(
  request: RepliesRequest,
  selectedTones: ReplyTone[],
): Promise<ReplyBatchGenerationResult> {
  const telemetry: ReplyGenerationTelemetry = {
    finalOutcome: 'error',
    groundingRepair: {
      attemptCount: 0,
      durationMs: 0,
      reason: 'not_triggered',
      triggered: false,
    },
    initialGeneration: {
      attemptCount: 0,
      durationMs: 0,
    },
    languageRepair: {
      attemptCount: 0,
      durationMs: 0,
      triggered: false,
    },
    ownershipValidation: 'not_run',
    ownershipValidationTrace: {
      initial: null,
      repair: null,
    },
  };
  const safeRequest = withSafeReplyTranscript(request);
  const normalizedVibeCheck = normalizeVibeCheckLanguage(
    safeRequest.vibeCheck,
    safeRequest.transcriptText,
  );
  const normalizedRequest = {
    ...safeRequest,
    vibeCheck: {
      ...normalizedVibeCheck,
      targetLanguage:
        resolveConversationLanguage(safeRequest.parsedConversation) ??
        normalizedVibeCheck.targetLanguage,
    },
  };

  try {
    const schema = createReplyBatchSchema(selectedTones);
    const initialGenerationStartedAt = Date.now();
    let result: ReplyBatchResult;

    try {
      result = await callOpenRouterStructured<ReplyBatchResult>({
        instrumentation: {
          onAttemptStart: () => {
            telemetry.initialGeneration.attemptCount += 1;
          },
        },
        prompt: buildReplyBatchPrompt(normalizedRequest, selectedTones),
        schema,
        schemaName: `wingr_reply_batch_${selectedTones.join('_')}`,
        task: 'reply',
      });
    } finally {
      telemetry.initialGeneration.durationMs = Date.now() - initialGenerationStartedAt;
    }

    let replyBatch = getCheckedReplyBatch(
      result.replyBatch ?? {},
      normalizedRequest,
      selectedTones,
    );
    telemetry.ownershipValidationTrace.initial = getReplyOwnershipValidationTrace(
      getFlattenedReplies(result.replyBatch ?? {}),
      normalizedRequest,
    );
    telemetry.ownershipValidation = hasMissingReply(replyBatch, selectedTones)
      ? 'rejected'
      : 'accepted';

    if (hasMissingReply(replyBatch, selectedTones)) {
      telemetry.groundingRepair.triggered = true;
      telemetry.groundingRepair.reason = 'no_ownership_safe_reply';
      const groundingRepairStartedAt = Date.now();
      let repairResult: ReplyBatchResult;

      try {
        repairResult = await callOpenRouterStructured<ReplyBatchResult>({
          instrumentation: {
            onAttemptStart: () => {
              telemetry.groundingRepair.attemptCount += 1;
            },
          },
          prompt: buildReplyGroundingRepairPrompt(
            normalizedRequest,
            getFlattenedReplies(result.replyBatch ?? {}),
            selectedTones,
          ),
          schema,
          schemaName: `wingr_reply_batch_grounding_repair_${selectedTones.join('_')}`,
          task: 'reply',
        });
      } finally {
        telemetry.groundingRepair.durationMs = Date.now() - groundingRepairStartedAt;
      }

      replyBatch = getCheckedReplyBatch(
        repairResult.replyBatch ?? {},
        normalizedRequest,
        selectedTones,
      );
      telemetry.ownershipValidationTrace.repair = getReplyOwnershipValidationTrace(
        getFlattenedReplies(repairResult.replyBatch ?? {}),
        normalizedRequest,
      );

      if (hasMissingReply(replyBatch, selectedTones)) {
        replyBatch = getFilteredReplyBatch(
          repairResult.replyBatch ?? {},
          normalizedRequest,
          selectedTones,
        );
      }
    }

    if (hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
      telemetry.languageRepair.triggered = true;
      const languageRepairStartedAt = Date.now();
      let repairResult: ReplyBatchResult;

      try {
        repairResult = await callOpenRouterStructured<ReplyBatchResult>({
          instrumentation: {
            onAttemptStart: () => {
              telemetry.languageRepair.attemptCount += 1;
            },
          },
          prompt: buildReplyLanguageRepairPrompt(
            normalizedRequest,
            getFlattenedReplies(replyBatch),
            selectedTones,
          ),
          schema: createReplyBatchSchema(selectedTones),
          schemaName: `wingr_reply_batch_repair_${selectedTones.join('_')}`,
          task: 'reply',
        });
      } finally {
        telemetry.languageRepair.durationMs = Date.now() - languageRepairStartedAt;
      }

      replyBatch = getFilteredReplyBatch(
        repairResult.replyBatch ?? {},
        normalizedRequest,
        selectedTones,
      );

      if (hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
        throw new Error(`Could not generate replies in ${normalizedRequest.vibeCheck.targetLanguage}.`);
      }
    }

    telemetry.finalOutcome = 'success';
    logReplyGenerationTiming(telemetry, selectedTones);
    return { replyBatch, telemetry };
  } catch (error) {
    const fallbackBatch = getFilteredReplyBatch(
      getMockBatchForRequest(normalizedRequest, selectedTones),
      normalizedRequest,
      selectedTones,
    );

    if (hasWrongLanguageInBatch(fallbackBatch, normalizedRequest)) {
      telemetry.finalOutcome = 'error';
      logReplyGenerationTiming(telemetry, selectedTones);
      throw error instanceof Error
        ? error
        : new Error(`Could not generate replies in ${normalizedRequest.vibeCheck.targetLanguage}.`);
    }

    telemetry.finalOutcome = 'fallback';
    logReplyGenerationTiming(telemetry, selectedTones);
    return { replyBatch: fallbackBatch, telemetry };
  }
}
