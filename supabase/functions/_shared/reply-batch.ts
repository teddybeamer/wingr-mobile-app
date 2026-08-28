import {
  normalizeVibeCheckLanguage,
  repliesLookWrongLanguage,
  resolveConversationLanguage,
} from './language.ts';
import { callOpenRouterStructured } from './openrouter.ts';
import { withSafeReplyTranscript } from './prompt-budget.ts';
import {
  buildReplyBatchPrompt,
  buildReplyEmergencyPrompt,
  buildReplyGroundingRepairPrompt,
  createReplyBatchSchema,
} from './prompting.ts';
import {
  getOwnershipCheckedReplies,
  getReplyOwnershipValidationTrace,
  getTerminalFallbackReply,
  type ReplyOwnershipRejectionCode,
} from './reply-ownership.ts';
import type { ReplyBatch, RepliesRequest, ReplyTone, SuggestedReply } from './types.ts';

const TOTAL_REPLY_DEADLINE_MS = 11_000;
const MAX_PRIMARY_PROVIDER_ATTEMPT_MS = 6_000;
const MAX_LATENCY_FALLBACK_ATTEMPT_MS = 3_000;
const MIN_TRANSPORT_FALLBACK_WINDOW_MS = 2_000;
const MIN_RECOVERY_STAGE_WINDOW_MS = 3_000;

type ReplyBatchResult = { replyBatch?: ReplyBatch };
type ReplyGenerationTiming = { attemptCount: number; durationMs: number };
type UnifiedRejectionCode = ReplyOwnershipRejectionCode | 'missing_selected_tone' | 'structured_output_invalid' | 'wrong_language';

type ValidationResult = {
  acceptedReplyCount: number;
  advisoryCodes: string[];
  candidateReplyCount: number;
  rejectionCodes: UnifiedRejectionCode[];
  rejectedReplyCount: number;
  replyBatch: ReplyBatch;
};

export type ReplyGenerationTelemetry = {
  finalOutcome: 'fallback' | 'success';
  generationId: string;
  initialGeneration: ReplyGenerationTiming;
  repairGeneration: ReplyGenerationTiming & { triggered: boolean };
  emergencyGeneration: ReplyGenerationTiming & { triggered: boolean };
  terminalFallback: { reasonCodes: string[]; used: boolean };
};

export type ReplyBatchGenerationResult = {
  replyBatch: ReplyBatch;
  telemetry: ReplyGenerationTelemetry;
};

function logReplyGenerationStage({
  acceptedReplyCount = 0,
  advisoryCodes = [],
  attemptCount = 0,
  candidateReplyCount = 0,
  durationMs = 0,
  generationId,
  outcome,
  reasonCodes = [],
  rejectedReplyCount = 0,
  selectedTone,
  stage,
}: {
  acceptedReplyCount?: number;
  advisoryCodes?: string[];
  attemptCount?: number;
  candidateReplyCount?: number;
  durationMs?: number;
  generationId: string;
  outcome: 'failed' | 'rejected' | 'skipped' | 'succeeded' | 'used';
  reasonCodes?: string[];
  rejectedReplyCount?: number;
  selectedTone: string;
  stage: 'primary_generation' | 'primary_validation' | 'repair_generation' | 'repair_validation' | 'emergency_generation' | 'emergency_validation' | 'terminal_fallback';
}) {
  const fields = {
    acceptedReplyCount,
    advisoryCodes,
    attemptCount,
    candidateReplyCount,
    durationMs,
    event: 'reply_generation_stage',
    generationId,
    outcome,
    reasonCodes,
    rejectedReplyCount,
    selectedTone,
    stage,
  };

  if (outcome === 'succeeded') {
    console.info('[Wingr AI] Reply generation stage', fields);
  } else {
    console.warn('[Wingr AI] Reply generation stage', fields);
  }
}

function getFlattenedReplies(replyBatch: ReplyBatch) {
  return Object.values(replyBatch).flatMap((replies) => replies ?? []);
}

function isSuggestedReply(value: unknown): value is SuggestedReply {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const reply = value as Partial<SuggestedReply>;
  return typeof reply.id === 'string' && typeof reply.text === 'string' && typeof reply.tone === 'string';
}

function hasStructuredReplyBatch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every((replies) =>
    Array.isArray(replies) && replies.every(isSuggestedReply)
  );
}

function getCheckedReplyBatch(replyBatch: ReplyBatch, request: RepliesRequest, selectedTones: ReplyTone[]) {
  return Object.fromEntries(
    selectedTones.map((tone) => [
      tone,
      getOwnershipCheckedReplies(replyBatch[tone] ?? [], { ...request, selectedTone: tone }),
    ]),
  ) as ReplyBatch;
}

function validateReplyBatch(
  result: ReplyBatchResult,
  request: RepliesRequest,
  selectedTones: ReplyTone[],
): ValidationResult {
  const rawReplyBatch = result.replyBatch;
  const candidateReplyCount = rawReplyBatch && typeof rawReplyBatch === 'object'
    ? getFlattenedReplies(rawReplyBatch).length
    : 0;

  if (!hasStructuredReplyBatch(rawReplyBatch)) {
    return {
      acceptedReplyCount: 0,
      advisoryCodes: [],
      candidateReplyCount,
      rejectionCodes: ['structured_output_invalid'],
      rejectedReplyCount: candidateReplyCount,
      replyBatch: {} as ReplyBatch,
    };
  }

  const checkedReplyBatch = getCheckedReplyBatch(rawReplyBatch, request, selectedTones);
  const ownershipTrace = getReplyOwnershipValidationTrace(getFlattenedReplies(rawReplyBatch), request);
  const rejectionCodes = new Set<UnifiedRejectionCode>(ownershipTrace.rejectionCodes);

  const hasMissingSelectedTone = selectedTones.some((tone) => {
    const replies = rawReplyBatch[tone];
    return !Array.isArray(replies) || replies.length === 0;
  });

  if (hasMissingSelectedTone) {
    rejectionCodes.add('missing_selected_tone');
  }

  if (rejectionCodes.size === 0 && repliesLookWrongLanguage(
    getFlattenedReplies(checkedReplyBatch),
    request.vibeCheck,
  )) {
    rejectionCodes.add('wrong_language');
  }

  return {
    acceptedReplyCount: ownershipTrace.acceptedReplyCount,
    advisoryCodes: ownershipTrace.meFactDirectedAtThemDetected ? ['me_fact_directed_at_them'] : [],
    candidateReplyCount,
    rejectionCodes: [...rejectionCodes],
    rejectedReplyCount: ownershipTrace.rejectedReplyCount,
    replyBatch: rejectionCodes.size === 0 ? checkedReplyBatch : {} as ReplyBatch,
  };
}

export async function generateReplyBatch(
  request: RepliesRequest,
  selectedTones: ReplyTone[],
): Promise<ReplyBatchGenerationResult> {
  const generationId = crypto.randomUUID();
  const deadlineAt = Date.now() + TOTAL_REPLY_DEADLINE_MS;
  const selectedTone = selectedTones.length === 1 ? selectedTones[0] : 'multiple';
  const telemetry: ReplyGenerationTelemetry = {
    finalOutcome: 'fallback',
    generationId,
    initialGeneration: { attemptCount: 0, durationMs: 0 },
    repairGeneration: { attemptCount: 0, durationMs: 0, triggered: false },
    emergencyGeneration: { attemptCount: 0, durationMs: 0, triggered: false },
    terminalFallback: { reasonCodes: [], used: false },
  };
  const safeRequest = withSafeReplyTranscript(request);
  const normalizedVibeCheck = normalizeVibeCheckLanguage(safeRequest.vibeCheck, safeRequest.transcriptText);
  const normalizedRequest = {
    ...safeRequest,
    vibeCheck: {
      ...normalizedVibeCheck,
      targetLanguage: resolveConversationLanguage(safeRequest.parsedConversation) ?? normalizedVibeCheck.targetLanguage,
    },
  };
  const schema = createReplyBatchSchema(selectedTones);
  const hasRecoveryBudget = () => Date.now() + MIN_RECOVERY_STAGE_WINDOW_MS < deadlineAt;
  const openRouterOptions = {
    deadlineAt,
    generationId,
    maxLatencyFallbackAttemptMs: MAX_LATENCY_FALLBACK_ATTEMPT_MS,
    maxPrimaryAttemptMs: MAX_PRIMARY_PROVIDER_ATTEMPT_MS,
    minLatencyFallbackWindowMs: MIN_TRANSPORT_FALLBACK_WINDOW_MS,
  };
  const useTerminalFallback = (reasonCodes: string[]) => {
    const replyBatch = Object.fromEntries(selectedTones.map((tone) => [
      tone,
      [getTerminalFallbackReply({ ...normalizedRequest, selectedTone: tone })],
    ])) as ReplyBatch;
    telemetry.finalOutcome = 'fallback';
    telemetry.terminalFallback = { reasonCodes, used: true };
    logReplyGenerationStage({ generationId, outcome: 'used', reasonCodes, selectedTone, stage: 'terminal_fallback' });
    return { replyBatch, telemetry };
  };
  const runEmergencyGeneration = async (reasonCodes: string[]) => {
    if (!hasRecoveryBudget()) {
      logReplyGenerationStage({
        generationId,
        outcome: 'skipped',
        reasonCodes: ['latency_budget_exhausted'],
        selectedTone,
        stage: 'emergency_generation',
      });
      return useTerminalFallback(['latency_budget_exhausted']);
    }

    telemetry.emergencyGeneration.triggered = true;
    const emergencyStartedAt = Date.now();
    let emergencyResult: ReplyBatchResult;

    try {
      emergencyResult = await callOpenRouterStructured<ReplyBatchResult>({
        ...openRouterOptions,
        instrumentation: { onAttemptStart: () => { telemetry.emergencyGeneration.attemptCount += 1; } },
        prompt: buildReplyEmergencyPrompt(normalizedRequest, selectedTones, reasonCodes),
        schema,
        schemaName: `wingr_reply_batch_emergency_${selectedTones.join('_')}`,
        task: 'reply',
      });
    } catch {
      telemetry.emergencyGeneration.durationMs = Date.now() - emergencyStartedAt;
      logReplyGenerationStage({
        attemptCount: telemetry.emergencyGeneration.attemptCount,
        durationMs: telemetry.emergencyGeneration.durationMs,
        generationId,
        outcome: 'failed',
        reasonCodes: ['model_request_failed'],
        selectedTone,
        stage: 'emergency_generation',
      });
      return useTerminalFallback(['emergency_model_request_failed']);
    }

    telemetry.emergencyGeneration.durationMs = Date.now() - emergencyStartedAt;
    logReplyGenerationStage({
      attemptCount: telemetry.emergencyGeneration.attemptCount,
      durationMs: telemetry.emergencyGeneration.durationMs,
      generationId,
      outcome: 'succeeded',
      selectedTone,
      stage: 'emergency_generation',
    });
    const emergencyValidation = validateReplyBatch(emergencyResult, normalizedRequest, selectedTones);
    logReplyGenerationStage({
      acceptedReplyCount: emergencyValidation.acceptedReplyCount,
      advisoryCodes: emergencyValidation.advisoryCodes,
      candidateReplyCount: emergencyValidation.candidateReplyCount,
      generationId,
      outcome: emergencyValidation.rejectionCodes.length === 0 ? 'succeeded' : 'rejected',
      reasonCodes: emergencyValidation.rejectionCodes,
      rejectedReplyCount: emergencyValidation.rejectedReplyCount,
      selectedTone,
      stage: 'emergency_validation',
    });
    if (emergencyValidation.rejectionCodes.length === 0) {
      telemetry.finalOutcome = 'success';
      return { replyBatch: emergencyValidation.replyBatch, telemetry };
    }

    return useTerminalFallback(emergencyValidation.rejectionCodes);
  };

  const initialStartedAt = Date.now();
  let initialResult: ReplyBatchResult;
  try {
    initialResult = await callOpenRouterStructured<ReplyBatchResult>({
      ...openRouterOptions,
      instrumentation: { onAttemptStart: () => { telemetry.initialGeneration.attemptCount += 1; } },
      prompt: buildReplyBatchPrompt(normalizedRequest, selectedTones),
      schema,
      schemaName: `wingr_reply_batch_${selectedTones.join('_')}`,
      task: 'reply',
    });
  } catch {
    telemetry.initialGeneration.durationMs = Date.now() - initialStartedAt;
    logReplyGenerationStage({
      attemptCount: telemetry.initialGeneration.attemptCount,
      durationMs: telemetry.initialGeneration.durationMs,
      generationId,
      outcome: 'failed',
      reasonCodes: ['model_request_failed'],
      selectedTone,
      stage: 'primary_generation',
    });
    return runEmergencyGeneration(['model_request_failed']);
  }

  telemetry.initialGeneration.durationMs = Date.now() - initialStartedAt;
  logReplyGenerationStage({
    attemptCount: telemetry.initialGeneration.attemptCount,
    durationMs: telemetry.initialGeneration.durationMs,
    generationId,
    outcome: 'succeeded',
    selectedTone,
    stage: 'primary_generation',
  });
  const initialValidation = validateReplyBatch(initialResult, normalizedRequest, selectedTones);
  logReplyGenerationStage({
    acceptedReplyCount: initialValidation.acceptedReplyCount,
    advisoryCodes: initialValidation.advisoryCodes,
    candidateReplyCount: initialValidation.candidateReplyCount,
    generationId,
    outcome: initialValidation.rejectionCodes.length === 0 ? 'succeeded' : 'rejected',
    reasonCodes: initialValidation.rejectionCodes,
    rejectedReplyCount: initialValidation.rejectedReplyCount,
    selectedTone,
    stage: 'primary_validation',
  });
  if (initialValidation.rejectionCodes.length === 0) {
    telemetry.finalOutcome = 'success';
    return { replyBatch: initialValidation.replyBatch, telemetry };
  }

  if (!hasRecoveryBudget()) {
    logReplyGenerationStage({
      generationId,
      outcome: 'skipped',
      reasonCodes: ['latency_budget_exhausted'],
      selectedTone,
      stage: 'repair_generation',
    });
    return useTerminalFallback(['latency_budget_exhausted']);
  }

  telemetry.repairGeneration.triggered = true;
  const repairStartedAt = Date.now();
  let repairResult: ReplyBatchResult;
  try {
    repairResult = await callOpenRouterStructured<ReplyBatchResult>({
      ...openRouterOptions,
      instrumentation: { onAttemptStart: () => { telemetry.repairGeneration.attemptCount += 1; } },
      prompt: buildReplyGroundingRepairPrompt(
        normalizedRequest,
        getFlattenedReplies(initialResult.replyBatch ?? {}),
        selectedTones,
        initialValidation.rejectionCodes,
      ),
      schema,
      schemaName: `wingr_reply_batch_repair_${selectedTones.join('_')}`,
      task: 'reply',
    });
  } catch {
    telemetry.repairGeneration.durationMs = Date.now() - repairStartedAt;
    logReplyGenerationStage({
      attemptCount: telemetry.repairGeneration.attemptCount,
      durationMs: telemetry.repairGeneration.durationMs,
      generationId,
      outcome: 'failed',
      reasonCodes: ['model_request_failed'],
      selectedTone,
      stage: 'repair_generation',
    });
    return runEmergencyGeneration(['repair_model_request_failed']);
  }

  telemetry.repairGeneration.durationMs = Date.now() - repairStartedAt;
  logReplyGenerationStage({
    attemptCount: telemetry.repairGeneration.attemptCount,
    durationMs: telemetry.repairGeneration.durationMs,
    generationId,
    outcome: 'succeeded',
    selectedTone,
    stage: 'repair_generation',
  });
  const repairValidation = validateReplyBatch(repairResult, normalizedRequest, selectedTones);
  logReplyGenerationStage({
    acceptedReplyCount: repairValidation.acceptedReplyCount,
    advisoryCodes: repairValidation.advisoryCodes,
    candidateReplyCount: repairValidation.candidateReplyCount,
    generationId,
    outcome: repairValidation.rejectionCodes.length === 0 ? 'succeeded' : 'rejected',
    reasonCodes: repairValidation.rejectionCodes,
    rejectedReplyCount: repairValidation.rejectedReplyCount,
    selectedTone,
    stage: 'repair_validation',
  });
  if (repairValidation.rejectionCodes.length === 0) {
    telemetry.finalOutcome = 'success';
    return { replyBatch: repairValidation.replyBatch, telemetry };
  }

  return runEmergencyGeneration(repairValidation.rejectionCodes);
}
