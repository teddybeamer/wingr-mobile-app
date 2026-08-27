import type { ParsedConversation } from './types.ts';

export const CONVERSATION_TURN_STATE_VERSION = 'structured-turn-state-v1';

export type ConversationTurnState = {
  latestMessageSender: 'me' | 'them' | 'unknown';
  messageCount: number;
  senderCounts: {
    me: number;
    them: number;
    unknown: number;
  };
  themMessagesAfterLatestMe: number;
  themHasRespondedAfterMe: boolean;
};

export function getConversationTurnState(
  parsedConversation?: ParsedConversation,
): ConversationTurnState | null {
  const messages = parsedConversation?.messages ?? [];

  if (messages.length === 0) {
    return null;
  }

  const latestMeIndex = [...messages].map((message) => message.sender).lastIndexOf('me');
  const themMessagesAfterLatestMe = messages
    .slice(latestMeIndex + 1)
    .filter((message) => message.sender === 'them').length;

  return {
    latestMessageSender: messages[messages.length - 1]?.sender ?? 'unknown',
    messageCount: messages.length,
    senderCounts: {
      me: messages.filter((message) => message.sender === 'me').length,
      them: messages.filter((message) => message.sender === 'them').length,
      unknown: messages.filter((message) => message.sender === 'unknown').length,
    },
    themHasRespondedAfterMe: themMessagesAfterLatestMe > 0,
    themMessagesAfterLatestMe,
  };
}
