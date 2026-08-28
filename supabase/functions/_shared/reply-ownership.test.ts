import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOwnershipCheckedReplies,
  getReplyOwnershipValidationTrace,
  getTerminalFallbackReply,
} from './reply-ownership.ts';
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

test('keeps light conversational inferences and neutral follow-ups', () => {
  [
    'Sounds like you’re getting the full family interrogation 😂',
    'Okay, so what’s the story there?',
    'I’m choosing to believe that was a compliment.',
    'You seem suspiciously confident about that.',
  ].forEach((text, index) => {
    const replies = getOwnershipCheckedReplies(
      [{ id: `reply-${index}`, text, tone: 'playful' }],
      request,
    );

    assert.equal(replies[0]?.text, text);
  });
});

test('uses one minimal language-aware terminal fallback', () => {
  assert.equal(getTerminalFallbackReply(request).text, 'Okay, tell me more 👀');
  assert.equal(getTerminalFallbackReply({
    ...request,
    vibeCheck: { ...request.vibeCheck, targetLanguage: 'Danish' },
  }).text, 'Fortæl mig lidt mere.');
});

test('accepts harmless Playful inference while recording the ME-only lexical overlap as advisory', () => {
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
          text: 'I am very competitive.',
          xPosition: 'right',
        },
        {
          boundingBox: { height: 20, width: 300, x: 10, y: 40 },
          confidence: 0.98,
          id: 'them-1',
          sender: 'them',
          speaker: 'other',
          text: 'Haha, I can tell.',
          xPosition: 'left',
        },
      ],
      shouldGenerateDirectReply: true,
      speakerAttributionConfidence: 0.98,
    },
    transcriptText: [
      'ME: I am very competitive.',
      'THEM: Haha, I can tell.',
    ].join('\n'),
  };

  const candidate = { id: 'reply-1', text: 'You sound competitive too, huh? 👀', tone: 'playful' as const };
  const replies = getOwnershipCheckedReplies(
    [candidate],
    conversationRequest,
  );

  assert.deepEqual(replies, [candidate]);
  assert.equal(getReplyOwnershipValidationTrace([candidate], conversationRequest).meFactDirectedAtThemDetected, true);
});

test('still rejects unsupported first-person ownership claims', () => {
  const replies = getOwnershipCheckedReplies(
    [{ id: 'reply-1', text: 'I love dogs too.', tone: 'playful' }],
    {
      ...request,
      contextNotes: { replyInstruction: [], situationNotes: [], themFacts: ['They have a dog.'], userFacts: [] },
    },
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
