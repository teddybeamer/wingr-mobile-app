import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRepliesPrompt,
  buildReplyLanguageRepairPrompt,
  createReplyBatchSchema,
  getMockReplies,
} from './prompting.ts';
import type { RepliesRequest } from './types.ts';

const request: RepliesRequest = {
  selectedTone: 'playful',
  transcriptText: 'THEM: Want to get coffee this week?',
  vibeCheck: {
    bestTone: 'playful',
    contextWouldImproveReplyQuality: false,
    conversationEnergy: 'Warm and open to making plans.',
    interestLevel: 'High',
    risk: 'Do not overthink it.',
    summary: 'Keep it easy and make a plan.',
    targetLanguage: 'English',
    vibeConfidence: 'high',
  },
};

test('reply batch schema requires exactly one reply for every requested tone', () => {
  const schema = createReplyBatchSchema(['playful', 'direct']);
  const toneSchemas = schema.properties.replyBatch.properties as Record<
    string,
    { maxItems: number; minItems: number }
  >;

  assert.deepEqual(toneSchemas.playful, {
    items: {
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
        tone: {
          enum: ['direct', 'playful', 'casualSmallTalk'],
          type: 'string',
        },
      },
      required: ['id', 'tone', 'text'],
      type: 'object',
    },
    maxItems: 1,
    minItems: 1,
    type: 'array',
  });
  assert.equal(toneSchemas.direct.minItems, 1);
  assert.equal(toneSchemas.direct.maxItems, 1);
});

test('reply prompts and mocks use one reply per selected tone', () => {
  const replyPrompt = buildRepliesPrompt(request);
  const repairPrompt = buildReplyLanguageRepairPrompt(request, [], ['playful']);

  assert.match(replyPrompt, /playful: generate exactly 1 reply/);
  assert.match(replyPrompt, /Write one suggested reply in English/);
  assert.doesNotMatch(replyPrompt, /exactly 2|both suggested replies/);
  assert.match(repairPrompt, /Rewrite exactly one reply in English for each requested tone/);
  assert.equal(getMockReplies('playful').length, 1);
});
