import {
  normalizeVibeCheckLanguage,
  repliesLookWrongLanguage,
  resolveConversationLanguage,
} from './language.ts';
import { callOpenRouterStructured } from './openrouter.ts';
import { withSafeReplyTranscript } from './prompt-budget.ts';
import {
  buildReplyBatchPrompt,
  buildReplyLanguageRepairPrompt,
  createReplyBatchSchema,
  getMockReplyBatch,
} from './prompting.ts';
import { getOwnershipSafeReplies } from './reply-ownership.ts';
import type { ReplyBatch, RepliesRequest, ReplyTone } from './types.ts';

type ReplyBatchResult = {
  replyBatch?: ReplyBatch;
};

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

function hasWrongLanguageInBatch(replyBatch: ReplyBatch, request: RepliesRequest) {
  return Object.values(replyBatch).some(
    (replies) => replies && repliesLookWrongLanguage(replies, request.vibeCheck),
  );
}

function getMockFollowUpReplies(selectedTone: ReplyTone) {
  const map: Record<ReplyTone, [string, string]> = {
    playful: [
      'Actually, I need your honest answer on that.',
      'Leaving that there while I pretend to be patient.',
    ],
    direct: [
      'No rush, but I would like to hear what you think.',
      'I meant that. Your turn when you get a second.',
    ],
    casualSmallTalk: [
      'Anyway, what are you up to now?',
      'Also, how is your day going?',
    ],
  };

  return map[selectedTone].map((text, index) => ({
    id: `${selectedTone}-follow-up-${index + 1}`,
    text,
    tone: selectedTone,
  }));
}

function getMockBatchForRequest(request: RepliesRequest, selectedTones: ReplyTone[]) {
  if (request.parsedConversation?.shouldGenerateDirectReply === false) {
    return Object.fromEntries(
      selectedTones.map((tone) => [tone, getMockFollowUpReplies(tone)]),
    ) as ReplyBatch;
  }

  return getMockReplyBatch(selectedTones);
}

export async function generateReplyBatch(request: RepliesRequest, selectedTones: ReplyTone[]) {
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
    const result = await callOpenRouterStructured<ReplyBatchResult>({
      prompt: buildReplyBatchPrompt(normalizedRequest, selectedTones),
      schema,
      schemaName: `wingr_reply_batch_${selectedTones.join('_')}`,
      task: 'reply',
    });

    let replyBatch = getFilteredReplyBatch(result.replyBatch ?? {}, normalizedRequest, selectedTones);

    if (hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
      const repairResult = await callOpenRouterStructured<ReplyBatchResult>({
        prompt: buildReplyLanguageRepairPrompt(
          normalizedRequest,
          getFlattenedReplies(replyBatch),
          selectedTones,
        ),
        schema: createReplyBatchSchema(selectedTones),
        schemaName: `wingr_reply_batch_repair_${selectedTones.join('_')}`,
        task: 'reply',
      });

      replyBatch = getFilteredReplyBatch(
        repairResult.replyBatch ?? {},
        normalizedRequest,
        selectedTones,
      );

      if (hasWrongLanguageInBatch(replyBatch, normalizedRequest)) {
        throw new Error(`Could not generate replies in ${normalizedRequest.vibeCheck.targetLanguage}.`);
      }
    }

    return replyBatch;
  } catch (error) {
    const fallbackBatch = getFilteredReplyBatch(
      getMockBatchForRequest(normalizedRequest, selectedTones),
      normalizedRequest,
      selectedTones,
    );

    if (hasWrongLanguageInBatch(fallbackBatch, normalizedRequest)) {
      throw error instanceof Error
        ? error
        : new Error(`Could not generate replies in ${normalizedRequest.vibeCheck.targetLanguage}.`);
    }

    return fallbackBatch;
  }
}
