import type { ParsedConversation } from './types.ts';

const SPEAKER_CONFIRMATION_THRESHOLD = 0.62;

export function needsSpeakerConfirmation(parsedConversation?: ParsedConversation) {
  if (!parsedConversation) {
    return false;
  }

  const confidentMeMessages = parsedConversation.messages.filter(
    (message) => message.sender === 'me' && message.confidence >= 0.62,
  ).length;
  const confidentThemMessages = parsedConversation.messages.filter(
    (message) => message.sender === 'them' && message.confidence >= 0.62,
  ).length;

  return (
    parsedConversation.speakerAttributionConfidence < SPEAKER_CONFIRMATION_THRESHOLD ||
    parsedConversation.latestMessageSender === 'unknown' ||
    (parsedConversation.speakerAttributionConfidence < 0.8 &&
      (confidentMeMessages === 0 || confidentThemMessages === 0))
  );
}
