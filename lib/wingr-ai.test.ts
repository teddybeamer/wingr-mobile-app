import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProvisionalVibeCheck, normalizeReplyBatch } from './wingr-ai';
import type { DetectedMessage, OcrResult } from '../types/wingr';

function message(id: string, sender: 'me' | 'them', text: string): DetectedMessage {
  return {
    id,
    sender,
    speaker: sender === 'them' ? 'other' : 'user',
    text,
    confidence: 0.95,
    xPosition: sender === 'them' ? 'left' : 'right',
    boundingBox: { x: 0, y: 0, width: 100, height: 24 },
  };
}

function ocrWithIncomingMessages(incomingTexts: string[], confidence = 0.9): OcrResult {
  const detectedMessages = [
    message('me-1', 'me', 'I had a great time talking with you yesterday.'),
    ...incomingTexts.map((text, index) => message(`them-${index + 1}`, 'them', text)),
  ];

  return {
    source: 'onDevice',
    confidence,
    detectedMessages,
    transcriptText: detectedMessages.map((item) => `${item.sender.toUpperCase()}: ${item.text}`).join('\n'),
    parsedConversation: {
      messages: detectedMessages,
      structuredConversation: detectedMessages.map((item) => ({ speaker: item.sender, text: item.text })),
      latestMessageSender: incomingTexts.length ? 'them' : 'me',
      shouldGenerateDirectReply: Boolean(incomingTexts.length),
      speakerAttributionConfidence: 0.95,
      speakerAttributionResolved: true,
    },
  };
}

test('normalizes every reply tone to its first generated reply', () => {
  const firstReply = { id: 'playful-1', text: 'First reply', tone: 'playful' as const };
  const secondReply = { id: 'playful-2', text: 'Second reply', tone: 'playful' as const };

  const replyBatch = normalizeReplyBatch({
    playful: [firstReply, secondReply],
  });

  assert.deepEqual(replyBatch.playful, [firstReply]);
  assert.equal(replyBatch.direct, undefined);
  assert.equal(replyBatch.casualSmallTalk, undefined);
});

test('classifies repeated short, neutral incoming replies as Low', () => {
  const vibeCheck = buildProvisionalVibeCheck(ocrWithIncomingMessages(['ok', 'yeah']));

  assert.equal(vibeCheck.interestLevel, 'Low');
});

test('keeps a single short neutral reply and one warm emoji at Medium', () => {
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(['okay'])).interestLevel,
    'Medium',
  );
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(['That sounds nice 😊'])).interestLevel,
    'Medium',
  );
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(['ok 😊', 'yeah'])).interestLevel,
    'Medium',
  );
});

test('classifies direct flirting, separate warm emojis, and playful teasing as High', () => {
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(["You're cute."])).interestLevel,
    'High',
  );
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(['That was fun 😊', 'Talk soon 😉'])).interestLevel,
    'High',
  );
  assert.equal(
    buildProvisionalVibeCheck(ocrWithIncomingMessages(["You're trouble."])).interestLevel,
    'High',
  );
});

test('returns Unclear when the incoming transcript is not reliable', () => {
  const vibeCheck = buildProvisionalVibeCheck(ocrWithIncomingMessages(['You are cute'], 0.2));

  assert.equal(vibeCheck.interestLevel, 'Unclear');
});
