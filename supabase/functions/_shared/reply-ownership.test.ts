import assert from 'node:assert/strict';
import test from 'node:test';
import { getOwnershipCheckedReplies, getOwnershipSafeReplies } from './reply-ownership.ts';
import type { RepliesRequest } from './types.ts';

const request: RepliesRequest = {
  selectedTone: 'direct',
  transcriptText: 'THEM: What are you doing this weekend?',
  vibeCheck: {
    bestTone: 'direct',
    conversationEnergy: 'They asked a direct question.',
    interestLevel: 'Medium',
    risk: 'Do not over-explain.',
    summary: 'Answer naturally.',
  },
};

test('uses a grounded fallback instead of the old vague ownership fallback', () => {
  const replies = getOwnershipSafeReplies(
    [
      {
        id: 'direct-1',
        text: 'Morgan, I am planning a hike and some reading.',
        tone: 'direct',
      },
    ],
    request,
  );

  assert.equal(replies[0]?.text, 'Got something in mind?');
  assert.doesNotMatch(replies[0]?.text ?? '', /what is the story/i);
});

test('uses distinct emergency fallbacks for different tones', () => {
  const invalidReply = [{ id: 'reply-1', text: 'Morgan, tell me more.', tone: 'playful' as const }];

  const playful = getOwnershipSafeReplies(invalidReply, { ...request, selectedTone: 'playful' });
  const casual = getOwnershipSafeReplies(invalidReply, { ...request, selectedTone: 'casualSmallTalk' });

  assert.notEqual(playful[0]?.text, casual[0]?.text);
  assert.notEqual(playful[0]?.text, 'Got something in mind?');
});

test('rejects a question that assigns a ME-only fact to THEM', () => {
  const conversationRequest: RepliesRequest = {
    ...request,
    parsedConversation: {
      latestMessageSender: 'them',
      messages: [
        {
          boundingBox: { height: 20, width: 300, x: 10, y: 10 },
          confidence: 0.98,
          id: 'me-1',
          sender: 'me',
          speaker: 'user',
          text: 'Jeg er på fjellet og skulle bygge en ishytte.',
          xPosition: 'right',
        },
        {
          boundingBox: { height: 20, width: 300, x: 10, y: 40 },
          confidence: 0.98,
          id: 'them-1',
          sender: 'them',
          speaker: 'other',
          text: 'Håber du overlever stormen.',
          xPosition: 'left',
        },
      ],
      shouldGenerateDirectReply: true,
      speakerAttributionConfidence: 0.98,
    },
    transcriptText: [
      'ME: Jeg er på fjellet og skulle bygge en ishytte.',
      'THEM: Håber du overlever stormen.',
    ].join('\n'),
  };

  const replies = getOwnershipCheckedReplies(
    [{ id: 'reply-1', text: 'Har I fundet på noget andet i stedet for ishytten?', tone: 'direct' }],
    conversationRequest,
  );

  assert.deepEqual(replies, []);
});

test('keeps a THEM-only fact available as a safe question hook', () => {
  const replies = getOwnershipCheckedReplies(
    [{ id: 'reply-1', text: 'How is your roommate visit going?', tone: 'direct' }],
    {
      ...request,
      parsedConversation: {
        latestMessageSender: 'them',
        messages: [
          {
            boundingBox: { height: 20, width: 300, x: 10, y: 10 },
            confidence: 0.98,
            id: 'me-1',
            sender: 'me',
            speaker: 'user',
            text: 'I am away with my brothers.',
            xPosition: 'right',
          },
          {
            boundingBox: { height: 20, width: 300, x: 10, y: 40 },
            confidence: 0.98,
            id: 'them-1',
            sender: 'them',
            speaker: 'other',
            text: 'My former roommate is visiting.',
            xPosition: 'left',
          },
        ],
        shouldGenerateDirectReply: true,
        speakerAttributionConfidence: 0.98,
      },
      transcriptText: 'ME: I am away with my brothers.\nTHEM: My former roommate is visiting.',
    },
  );

  assert.equal(replies[0]?.text, 'How is your roommate visit going?');
});
