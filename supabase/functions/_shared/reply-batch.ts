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
} from './prompting.ts';
import {
  getOwnershipCheckedReplies,
  getReplyOwnershipValidationTrace,
  getOwnershipSafeReplies,
} from './reply-ownership.ts';
import type { ReplyBatch, RepliesRequest, ReplyTone } from './types.ts';

const OPTIONAL_RECOVERY_BUDGET_MS = 15_000;
const MIN_OPTIONAL_RECOVERY_WINDOW_MS = 1_000;

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
    reason: 'latency_budget_exhausted' | 'not_triggered' | 'no_ownership_safe_reply';
    triggered: boolean;
  };
  initialGeneration: ReplyGenerationTiming;
  languageRepair: ReplyGenerationTiming & {
    skippedForLatencyBudget: boolean;
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

function getLocalFallbackBatch(
  request: RepliesRequest,
  selectedTones: ReplyTone[],
) {
  return getFilteredReplyBatch({}, request, selectedTones);
}

export async function generateReplyBatch(
  request: RepliesRequest,
  selectedTones: ReplyTone[],
): Promise<ReplyBatchGenerationResult> {
  const recoveryDeadlineAt = Date.now() + OPTIONAL_RECOVERY_BUDGET_MS;
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
      skippedForLatencyBudget: false,
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
  const hasOptionalRecoveryBudget = () =>
    Date.now() + MIN_OPTIONAL_RECOVERY_WINDOW_MS < recoveryDeadlineAt;

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

    let replyBatchSource: 'model' | 'localFallback' = 'model';

    if (hasMissingReply(replyBatch, selectedTones)) {
      if (!hasOptionalRecoveryBudget()) {
        telemetry.groundingRepair.reason = 'latency_budget_exhausted';
        replyBatch = getLocalFallbackBatch(normalizedRequest, selectedTones);
        replyBatchSource = 'localFallback';
      } else {
        telemetry.groundingRepair.triggered = true;
        telemetry.groundingRepair.reason = 'no_ownership_safe_reply';
        const groundingRepairStartedAt = Date.now();
        let repairResult: ReplyBatchResult;

        try {
          repairResult = await callOpenRouterStructured<ReplyBatchResult>({
            deadlineAt: recoveryDeadlineAt,
            instrumentation: {
              onAttemptStart: () => {
                telemetry.groundingRepair.attemptCount += 1;
              },
            },
            prompt: buildReplyGroundingRepairPrompt(
              normalizedRequest,
              getFlattenedReplies(result.replyBatch ?? {}),
              selectedTones,
              telemetry.ownershipValidationTrace.initial?.rejectionCodes,
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
        telemetry.ownershipValidation = hasMissingReply(replyBatch, selectedTones)
          ? 'rejected'
          : 'accepted';

        if (hasMissingReply(replyBatch, selectedTones)) {
          replyBatch = getLocalFallbackBatch(normalizedRequest, selectedTones);
          replyBatchSource = 'localFallback';
        }
      }
    }

    if (replyBatchSource === 'model' && hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
      if (!hasOptionalRecoveryBudget()) {
        telemetry.languageRepair.skippedForLatencyBudget = true;
        replyBatch = getLocalFallbackBatch(normalizedRequest, selectedTones);
        replyBatchSource = 'localFallback';
      } else {
        telemetry.languageRepair.triggered = true;
        const languageRepairStartedAt = Date.now();
        let repairResult: ReplyBatchResult;

        try {
          repairResult = await callOpenRouterStructured<ReplyBatchResult>({
            deadlineAt: recoveryDeadlineAt,
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

        replyBatch = getCheckedReplyBatch(
          repairResult.replyBatch ?? {},
          normalizedRequest,
          selectedTones,
        );

        if (hasMissingReply(replyBatch, selectedTones) || hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
          replyBatch = getLocalFallbackBatch(normalizedRequest, selectedTones);
          replyBatchSource = 'localFallback';
        }
      }
    }

    telemetry.finalOutcome = replyBatchSource === 'localFallback' ? 'fallback' : 'success';
    logReplyGenerationTiming(telemetry, selectedTones);
    return { replyBatch, telemetry };
  } catch (error) {
    const fallbackBatch = getLocalFallbackBatch(normalizedRequest, selectedTones);
    telemetry.finalOutcome = 'fallback';
    logReplyGenerationTiming(telemetry, selectedTones);
    return { replyBatch: fallbackBatch, telemetry };
  }
}
