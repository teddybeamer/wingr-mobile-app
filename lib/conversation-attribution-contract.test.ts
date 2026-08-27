import assert from 'node:assert/strict';
import test from 'node:test';
import { getConversationBackendContract } from './conversation-attribution-contract';
import type { ParsedConversation } from '../types/wingr';

function parsedConversation(resolved: boolean): ParsedConversation {
  return {
    latestMessageSender: resolved ? 'them' : 'unknown',
    messages: [
      {
        boundingBox: { height: 24, width: 180, x: 20, y: 100 },
        confidence: resolved ? 0.95 : 0.2,
        id: 'message-1',
        sender: resolved ? 'them' : 'unknown',
        speaker: resolved ? 'other' : 'unknown',
        text: 'Want to get coffee?',
        xPosition: resolved ? 'left' : 'center',
      },
    ],
    shouldGenerateDirectReply: resolved,
    speakerAttributionConfidence: resolved ? 0.95 : 0.2,
    speakerAttributionResolved: resolved,
    structuredConversation: [{ speaker: resolved ? 'them' : 'unknown', text: 'Want to get coffee?' }],
  };
}

test('requires speaker confirmation instead of allowing an unresolved conversation to reach AI requests', () => {
  assert.deepEqual(getConversationBackendContract(parsedConversation(false)), {
    kind: 'needsSpeakerConfirmation',
  });
});

test('passes the resolved parsedConversation contract through to Vibe Check and reply generation', () => {
  const resolvedConversation = parsedConversation(true);

  assert.deepEqual(getConversationBackendContract(resolvedConversation), {
    kind: 'ready',
    parsedConversation: resolvedConversation,
  });
});
