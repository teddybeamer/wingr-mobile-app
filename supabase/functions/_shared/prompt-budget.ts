import type { RepliesRequest, VibeCheckRequest } from './types.ts';
import { cleanTranscriptForAi } from './transcript-cleanup.ts';

export const MAX_VIBECHECK_TRANSCRIPT_CHARS = 4000;
export const MAX_REPLY_TRANSCRIPT_CHARS = 6000;
export const MAX_VIBECHECK_ESTIMATED_TOKENS = 3000;
export const MAX_REPLY_ESTIMATED_TOKENS = 5000;

export type AiRequestType = 'vibeCheck' | 'reply';

export function estimateTokens(totalCharacters: number) {
  return Math.ceil(totalCharacters / 4);
}

export function getRequestTypeLabel(requestType: AiRequestType) {
  return requestType === 'vibeCheck' ? 'vibecheck' : 'replies';
}

export function getEstimatedTokenBudget(requestType: AiRequestType) {
  return requestType === 'vibeCheck'
    ? MAX_VIBECHECK_ESTIMATED_TOKENS
    : MAX_REPLY_ESTIMATED_TOKENS;
}

export function getTranscriptCharBudget(requestType: AiRequestType) {
  return requestType === 'vibeCheck'
    ? MAX_VIBECHECK_TRANSCRIPT_CHARS
    : MAX_REPLY_TRANSCRIPT_CHARS;
}

export function trimTranscriptForRequest(transcriptText: string, requestType: AiRequestType) {
  const maxChars = getTranscriptCharBudget(requestType);
  const trimmed = cleanTranscriptForAi(transcriptText).trim();

  return trimmed.length > maxChars ? trimmed.slice(-maxChars) : trimmed;
}

export function withSafeVibeCheckTranscript(request: VibeCheckRequest): VibeCheckRequest {
  return {
    ...request,
    transcriptText: trimTranscriptForRequest(request.transcriptText, 'vibeCheck'),
  };
}

export function withSafeReplyTranscript(request: RepliesRequest): RepliesRequest {
  return {
    ...request,
    transcriptText: trimTranscriptForRequest(request.transcriptText, 'reply'),
  };
}
