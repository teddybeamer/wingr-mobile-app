import assert from 'node:assert/strict';
import test from 'node:test';
import { getConversationTurnState } from './conversation-turn-state.ts';
import type { ParsedConversation } from './types.ts';

function conversation(messages: Array<{ sender: 'me' | 'them'; text: string }>): ParsedConversation {
  return {
    latestMessageSender: messages[messages.length - 1]?.sender ?? 'unknown',
    messages: messages.map((message, index) => ({
      boundingBox: { height: 24, width: 180, x: 20, y: index * 30 },
      confidence: 0.98,
      id: `message-${index + 1}`,
      sender: message.sender,
      speaker: message.sender === 'me' ? 'user' : 'other',
      text: message.text,
      xPosition: message.sender === 'me' ? 'right' : 'left',
    })),
    shouldGenerateDirectReply: messages[messages.length - 1]?.sender === 'them',
    speakerAttributionConfidence: 0.98,
  };
}

const expectedTurnState = {
  latestMessageSender: 'them',
  messageCount: 3,
  senderCounts: { me: 1, them: 2, unknown: 0 },
  themHasRespondedAfterMe: true,
  themMessagesAfterLatestMe: 2,
};

test('derives the same authoritative ME → THEM → THEM state for Danish and English', () => {
  const danish = conversation([
    { sender: 'me', text: 'Jeg er i Norge med mine brødre på fjellet i stormen.' },
    { sender: 'them', text: 'Jeg hygger hjemme med min tidligere roommate.' },
    { sender: 'them', text: 'Håber du overlever stormen.' },
  ]);
  const english = conversation([
    { sender: 'me', text: 'I am in Norway with my brothers in the mountains during a storm.' },
    { sender: 'them', text: 'I am relaxing at home with my former roommate.' },
    { sender: 'them', text: 'I hope you make it through the storm.' },
  ]);

  assert.deepEqual(getConversationTurnState(danish), expectedTurnState);
  assert.deepEqual(getConversationTurnState(english), expectedTurnState);
});
