import { getContextNotes } from './context-notes.ts';
import type { ContextNotes, RepliesRequest, SuggestedReply } from './types.ts';

const PET_WORD_PATTERN =
  /\b(dog|dogs|pup|pups|puppy|puppies|pet|pets|fur\s+baby|fur\s+children|furry)\b/i;

const USER_PET_CLAIM_PATTERNS = [
  /\b(my|our)\s+(?:own\s+)?(?:dog|dogs|pup|pups|puppy|puppies|pet|pets|fur\s+baby|fur\s+children|furry\s+(?:friend|roommate|companion))\b/i,
  /\b(?:with|walk|walks|walked|walking|take|takes|taking|took)\s+(?:out\s+)?(?:my|our)\s+(?:dog|pup|puppy|pet)\b/i,
  /\bi\s+(?:also\s+|really\s+|kind\s+of\s+)?(?:have|own|got|adopted|walk|walked|walking|take|took|love|like|adore)\s+(?:a|an|my|our)?\s*(?:dog|dogs|pup|pups|puppy|puppies|pet|pets)\b/i,
  /\bi(?:'m|’m| am)\s+(?:a\s+)?(?:dog|pet)\s+(?:person|owner|lover)\b/i,
];

const FIRST_PERSON_INTEREST_PATTERN =
  /\bi\s+(?:also\s+|really\s+|kind\s+of\s+)?(?:love|like|adore|am into|am a fan of)\b/i;

const STOPWORDS = new Set([
  'about',
  'also',
  'that',
  'their',
  'them',
  'they',
  'this',
  'with',
  'would',
]);

function normalizeNotes(request: RepliesRequest): ContextNotes {
  const notes = request.contextNotes ?? getContextNotes(request.extraContext);

  return {
    replyInstruction: notes.replyInstruction ?? [],
    situationNotes: notes.situationNotes ?? [],
    themFacts: notes.themFacts ?? [],
    userFacts: notes.userFacts ?? [],
  };
}

function getUserTranscriptText(transcriptText: string) {
  return transcriptText
    .split('\n')
    .filter((line) => /^\s*You\s*:/i.test(line))
    .map((line) => line.replace(/^\s*You\s*:\s*/i, ''))
    .join(' ');
}

function hasUserPetEvidence(notes: ContextNotes, transcriptText: string) {
  const userText = `${notes.userFacts.join(' ')} ${getUserTranscriptText(transcriptText)}`;

  return USER_PET_CLAIM_PATTERNS.some((pattern) => pattern.test(userText));
}

function contextMentionsPets(notes: ContextNotes) {
  const themContext = [...notes.themFacts, ...notes.situationNotes, ...notes.replyInstruction].join(' ');

  return PET_WORD_PATTERN.test(themContext);
}

function singularize(word: string) {
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }

  return word.endsWith('s') ? word.slice(0, -1) : word;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getThemFactKeywords(notes: ContextNotes) {
  const keywords = new Set<string>();
  const words = notes.themFacts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(singularize)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  words.forEach((word) => keywords.add(word));

  if (contextMentionsPets(notes)) {
    ['dog', 'pup', 'puppy', 'pet'].forEach((word) => keywords.add(word));
  }

  return [...keywords];
}

function getUserOwnedKeywords(notes: ContextNotes, transcriptText: string) {
  const keywords = new Set<string>();
  const userText = `${notes.userFacts.join(' ')} ${getUserTranscriptText(transcriptText)}`;
  const words = userText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(singularize)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  words.forEach((word) => keywords.add(word));

  if (hasUserPetEvidence(notes, transcriptText)) {
    ['dog', 'pup', 'puppy', 'pet'].forEach((word) => keywords.add(word));
  }

  return keywords;
}

function hasUnsupportedPetClaim(replyText: string, notes: ContextNotes, transcriptText: string) {
  if (!contextMentionsPets(notes) || hasUserPetEvidence(notes, transcriptText)) {
    return false;
  }

  return USER_PET_CLAIM_PATTERNS.some((pattern) => pattern.test(replyText));
}

function hasUnsupportedKeywordOwnership(replyText: string, notes: ContextNotes, transcriptText: string) {
  const userOwnedKeywords = getUserOwnedKeywords(notes, transcriptText);

  return getThemFactKeywords(notes).some((keyword) => {
    if (userOwnedKeywords.has(keyword)) {
      return false;
    }

    const keywordPattern = escapeRegExp(keyword);
    const possessivePattern = new RegExp(
      `\\b(my|our)\\b(?:[\\W_]+\\w+){0,3}[\\W_]+${keywordPattern}s?\\b`,
      'i',
    );
    const interestPattern = new RegExp(`${FIRST_PERSON_INTEREST_PATTERN.source}.{0,40}\\b${keywordPattern}s?\\b`, 'i');

    return possessivePattern.test(replyText) || interestPattern.test(replyText);
  });
}

function getReplyOwnershipIssues(replyText: string, request: RepliesRequest) {
  const notes = normalizeNotes(request);
  const issues: string[] = [];

  if (hasUnsupportedPetClaim(replyText, notes, request.transcriptText)) {
    issues.push('Reply implies the user owns or loves a pet without user evidence.');
  }

  if (hasUnsupportedKeywordOwnership(replyText, notes, request.transcriptText)) {
    issues.push('Reply turns a fact about the other person into a user-owned claim.');
  }

  return issues;
}

function getFallbackReplies(request: RepliesRequest): SuggestedReply[] {
  const notes = normalizeNotes(request);

  if (contextMentionsPets(notes)) {
    return [
      {
        id: 'ownership-safe-dog-1',
        text: 'That detail deserves a dog story. What is the latest one?',
        tone: request.selectedTone,
      },
      {
        id: 'ownership-safe-dog-2',
        text: 'Okay, quick dog question: big dogs or tiny dogs?',
        tone: request.selectedTone,
      },
    ];
  }

  return [
    {
      id: 'ownership-safe-context-1',
      text: 'Okay, I have to ask about that. What is the story?',
      tone: request.selectedTone,
    },
    {
      id: 'ownership-safe-context-2',
      text: 'That sounds like it needs a follow-up. Tell me more?',
      tone: request.selectedTone,
    },
  ];
}

export function getOwnershipSafeReplies(replies: SuggestedReply[], request: RepliesRequest) {
  const safeReplies = replies.filter((reply) => getReplyOwnershipIssues(reply.text, request).length === 0);

  if (safeReplies.length >= 2) {
    return safeReplies.slice(0, 2);
  }

  const fallbackReplies = getFallbackReplies(request).filter(
    (reply) => getReplyOwnershipIssues(reply.text, request).length === 0,
  );

  return [...safeReplies, ...fallbackReplies].slice(0, 2);
}
