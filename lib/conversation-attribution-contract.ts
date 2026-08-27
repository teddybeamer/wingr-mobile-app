import { needsSpeakerConfirmation } from './wingr-ocr';
import type { ParsedConversation } from '../types/wingr';

export type ConversationBackendContract =
  | {
      kind: 'needsSpeakerConfirmation';
    }
  | {
      kind: 'ready';
      parsedConversation: ParsedConversation;
    };

/**
 * Backend analysis is only allowed to run with resolved speaker attribution.
 * Callers may choose how to collect confirmation, but not bypass it.
 */
export function getConversationBackendContract(
  parsedConversation: ParsedConversation,
): ConversationBackendContract {
  if (needsSpeakerConfirmation(parsedConversation)) {
    return { kind: 'needsSpeakerConfirmation' };
  }

  return { kind: 'ready', parsedConversation };
}
