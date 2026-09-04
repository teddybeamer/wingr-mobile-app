import { getContextNotes } from './context-notes.ts';
import {
  claimsUnknownMeFact,
  getReplyAnswerability,
  getReplyPlaceholders,
  hasAllowedReplyPlaceholder,
  hasInvalidReplyPlaceholder,
} from './reply-answerability.ts';
import { getSuspiciousOcrTokens } from './transcript-cleanup.ts';
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

const ADDRESS_NAME_PREFIX_PATTERN =
  /^\s*(?:(?:hey|hi|hej|hello|yo|okay|ok|haha|lol)\s+)?([A-ZÆØÅ][\p{L}'’-]{2,})\s*[,!]/u;
const ADDRESS_NAME_TRAILING_PATTERN =
  /(?:,\s*|\b(?:dig|you|du)\s+)([A-ZÆØÅ][\p{L}'’-]{2,}(?:\s+[A-ZÆØÅ][\p{L}'’-]{2,})?)\s*[?.!]*$/u;
const MULTI_WORD_PROPER_NAME_PATTERN =
  /\b([A-ZÆØÅ][\p{L}'’-]{2,}\s+[A-ZÆØÅ][\p{L}'’-]{2,})\b/gu;
const THANKS_PATTERN = /\b(thanks|thank you|tak|tusind tak|mange tak|aw thanks|aww thanks)\b/i;
const THANKS_WORTHY_OTHER_PATTERN =
  /\b(cute|sød|flot|smuk|dejlig|handsome|pretty|beautiful|hot|nice picture|godt billede|kompliment|compliment|like your|love your|du ser|you look|made me smile)\b/i;
const USER_SAID_PERSPECTIVE_PATTERN =
  /\b(i|jeg)\s+(?:said|asked|sent|wrote|skrev|spurgte|sendte|sagde)\b/i;
const OTHER_PERSON_PERSPECTIVE_PATTERN =
  /\b(as the other person|from their side|som den anden person|jeg ville svare som dem)\b/i;
const DIRECT_ADDRESS_ALLOWLIST = new Set([
  'fair',
  'haha',
  'hej',
  'hello',
  'hi',
  'lol',
  'okay',
]);

export type ReplyOwnershipValidationTrace = {
  acceptedReplyCount: number;
  checkedReplyCount: number;
  containedAllowedPlaceholder: boolean;
  containedPlaceholder: boolean;
  invalidPlaceholderDetected: boolean;
  meFactDirectedAtThemDetected: boolean;
  rejectionCodes: ReplyOwnershipRejectionCode[];
  rejectedReplyCount: number;
  unsupportedUnknownMeFactClaimDetected: boolean;
};

export type ReplyOwnershipRejectionCode =
  | 'fact_owner_reversal'
  | 'ocr_noise'
  | 'ownership_or_grounding'
  | 'unsupported_me_fact'
  | 'unsupported_name'
  | 'wrong_speaker';

function getReplyOwnershipRejectionCodes(
  replies: SuggestedReply[],
  request: RepliesRequest,
): ReplyOwnershipRejectionCode[] {
  const issues = replies.flatMap((reply) => getReplyOwnershipIssues(reply.text, request));

  return [...new Set(issues)];
}

const QUESTION_FOR_OTHER_PATTERN =
  /\b(?:you|your|yours|du|dig|din|dit|dine|jer|dein|deine|deinen|deiner|euch|ihr|tu|vous|ton|ta|tes|votre|vos|tú|tu|usted|ustedes|vuestro|vuestra)\b/i;
const DANISH_PLURAL_QUESTION_PATTERN =
  /\b(?:Har|Er|Skal|Vil|Kan|Må|Synes)\s+I\b/u;

const FACT_STOPWORDS = new Set([
  'about', 'after', 'also', 'been', 'bare', 'before', 'because', 'could', 'det',
  'der', 'dere', 'den', 'denne', 'dette', 'does', 'from', 'have', 'here', 'into',
  'just', 'med', 'mine', 'more', 'over', 'på', 'skal', 'som', 'that', 'their',
  'them', 'there', 'they', 'this', 'them', 'var', 'were', 'what', 'with', 'would',
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
    .filter((line) => /^\s*(ME|You)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*(ME|You)\s*:\s*/i, ''))
    .join(' ');
}

function getTranscriptTextForSender(request: RepliesRequest, sender: 'me' | 'them') {
  const structuredMessages = request.parsedConversation?.messages ?? [];

  if (structuredMessages.length > 0) {
    return structuredMessages
      .filter((message) => message.sender === sender)
      .map((message) => message.text)
      .join(' ');
  }

  const label = sender === 'me' ? 'ME|You' : 'THEM|Them';

  return request.transcriptText
    .split('\n')
    .filter((line) => new RegExp(`^\\s*(?:${label})\\s*:`, 'i').test(line))
    .map((line) => line.replace(new RegExp(`^\\s*(?:${label})\\s*:\\s*`, 'i'), ''))
    .join(' ');
}

function getFactTerms(text: string) {
  return normalizeForLooseLookup(text)
    .split(' ')
    .filter((word) => word.length >= 5 && !FACT_STOPWORDS.has(word));
}

function termsOverlap(left: string, right: string) {
  return left === right ||
    (left.length >= 5 && right.length >= 5 && (left.startsWith(right) || right.startsWith(left)));
}

function asksOtherPersonAboutMeOnlyFact(replyText: string, request: RepliesRequest) {
  if (!replyText.includes('?')) {
    return false;
  }

  const asksOtherPerson = QUESTION_FOR_OTHER_PATTERN.test(replyText) ||
    DANISH_PLURAL_QUESTION_PATTERN.test(replyText);

  if (!asksOtherPerson) {
    return false;
  }

  const meTerms = getFactTerms(getTranscriptTextForSender(request, 'me'));
  const themTerms = getFactTerms(getTranscriptTextForSender(request, 'them'));
  const replyTerms = getFactTerms(replyText);
  const meOnlyTerms = meTerms.filter(
    (meTerm) => !themTerms.some((themTerm) => termsOverlap(meTerm, themTerm)),
  );

  return replyTerms.some((replyTerm) =>
    meOnlyTerms.some((meTerm) => termsOverlap(replyTerm, meTerm)),
  );
}

function normalizeForLooseLookup(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getLatestOtherText(request: RepliesRequest) {
  const messages = request.parsedConversation?.messages ?? [];
  const latestOther = [...messages].reverse().find(
    (message) => message.sender === 'them' || message.speaker === 'other',
  );

  if (latestOther?.text) {
    return latestOther.text;
  }

  return request.transcriptText
    .split('\n')
    .filter((line) => /^\s*(THEM|Them)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*(THEM|Them)\s*:\s*/i, ''))
    .pop() ?? '';
}

function getUnsupportedDirectAddress(replyText: string, transcriptText: string) {
  const transcriptWords = normalizeForLooseLookup(transcriptText).split(' ');
  const candidates = [
    ADDRESS_NAME_PREFIX_PATTERN.exec(replyText)?.[1],
    ADDRESS_NAME_TRAILING_PATTERN.exec(replyText)?.[1],
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => {
    const words = candidate.toLowerCase().split(/\s+/).filter(Boolean);

    if (words.some((word) => DIRECT_ADDRESS_ALLOWLIST.has(word))) {
      return false;
    }

    return words.some((word) => !transcriptWords.includes(word));
  });
}

function getUnsupportedProperName(replyText: string, transcriptText: string) {
  const transcriptWords = normalizeForLooseLookup(transcriptText).split(' ');
  const candidates = [...replyText.matchAll(MULTI_WORD_PROPER_NAME_PATTERN)].map((match) => match[1]);

  return candidates.find((candidate) => {
    const words = candidate.toLowerCase().split(/\s+/).filter(Boolean);

    return words.some((word) => !transcriptWords.includes(word));
  });
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

function getFallbackLanguage(targetLanguage?: string) {
  return targetLanguage?.trim().toLowerCase() ?? 'english';
}

function getThemFactKeywords(notes: ContextNotes, targetLanguage?: string) {
  const keywords = new Set<string>();
  const words = notes.themFacts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(singularize)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  words.forEach((word) => keywords.add(word));

  const language = getFallbackLanguage(targetLanguage);

  if (contextMentionsPets(notes) && (language === 'danish' || language === 'english')) {
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

function hasUnsupportedKeywordOwnership(
  replyText: string,
  notes: ContextNotes,
  transcriptText: string,
  targetLanguage?: string,
) {
  const userOwnedKeywords = getUserOwnedKeywords(notes, transcriptText);

  return getThemFactKeywords(notes, targetLanguage).some((keyword) => {
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
  const issues = new Set<ReplyOwnershipRejectionCode>();
  const suspiciousReplyTokens = getSuspiciousOcrTokens(replyText);
  const answerability = getReplyAnswerability(request);

  if (suspiciousReplyTokens.length > 0) {
    issues.add('ocr_noise');
  }

  if (hasInvalidReplyPlaceholder(replyText, answerability)) {
    issues.add('ownership_or_grounding');
  }

  if (claimsUnknownMeFact(replyText, answerability)) {
    issues.add('unsupported_me_fact');
  }

  if (hasUnsupportedPetClaim(replyText, notes, request.transcriptText)) {
    issues.add('unsupported_me_fact');
  }

  if (hasUnsupportedKeywordOwnership(
    replyText,
    notes,
    request.transcriptText,
    request.vibeCheck.targetLanguage,
  )) {
    issues.add('fact_owner_reversal');
  }

  const addressedName = getUnsupportedDirectAddress(replyText, request.transcriptText);

  if (addressedName) {
    issues.add('unsupported_name');
  }

  if (getUnsupportedProperName(replyText, request.transcriptText)) {
    issues.add('unsupported_name');
  }

  const latestOtherText = getLatestOtherText(request);

  if (THANKS_PATTERN.test(replyText) && !THANKS_WORTHY_OTHER_PATTERN.test(latestOtherText)) {
    issues.add('ownership_or_grounding');
  }

  if (request.parsedConversation?.shouldGenerateDirectReply === false && THANKS_PATTERN.test(replyText)) {
    issues.add('wrong_speaker');
  }

  if (USER_SAID_PERSPECTIVE_PATTERN.test(replyText) || OTHER_PERSON_PERSPECTIVE_PATTERN.test(replyText)) {
    issues.add('wrong_speaker');
  }

  return [...issues];
}

export function getReplyOwnershipValidationTrace(
  replies: SuggestedReply[],
  request: RepliesRequest,
): ReplyOwnershipValidationTrace {
  const issueLists = replies.map((reply) => getReplyOwnershipIssues(reply.text, request));
  const acceptedReplyCount = issueLists.filter((issues) => issues.length === 0).length;
  const answerability = getReplyAnswerability(request);

  return {
    acceptedReplyCount,
    checkedReplyCount: replies.length,
    containedAllowedPlaceholder: replies.some((reply) =>
      hasAllowedReplyPlaceholder(reply.text, answerability)
    ),
    containedPlaceholder: replies.some((reply) =>
      getReplyPlaceholders(reply.text).length > 0
    ),
    invalidPlaceholderDetected: replies.some((reply) =>
      hasInvalidReplyPlaceholder(reply.text, answerability)
    ),
    meFactDirectedAtThemDetected: replies.some((reply) =>
      asksOtherPersonAboutMeOnlyFact(reply.text, request),
    ),
    rejectionCodes: getReplyOwnershipRejectionCodes(replies, request),
    rejectedReplyCount: replies.length - acceptedReplyCount,
    unsupportedUnknownMeFactClaimDetected: replies.some((reply) =>
      claimsUnknownMeFact(reply.text, answerability)
    ),
  };
}

function getPlaceholderFallbackText(request: RepliesRequest) {
  const answerability = getReplyAnswerability(request);

  if (!answerability.placeholderAllowed || !answerability.placeholder || !answerability.factKind) {
    return undefined;
  }

  const language = getFallbackLanguage(request.vibeCheck.targetLanguage);
  const suffix = language === 'danish' ? '— hvad med dig?' : '— what about you?';
  const prefixes: Record<typeof answerability.factKind, string> = language === 'danish'
    ? {
      favorite: 'Jeg ville nok sige',
      hometown: 'Jeg er fra',
      job: 'Jeg arbejder som',
      looking_for: 'Jeg leder efter',
      plans: 'Mine planer er',
    }
    : {
      favorite: "I'd probably say",
      hometown: "I'm from",
      job: 'I work as',
      looking_for: "I'm looking for",
      plans: 'My plans are',
    };

  return `${prefixes[answerability.factKind]} ${answerability.placeholder} ${suffix}`;
}

export function getTerminalFallbackReply(request: RepliesRequest): SuggestedReply {
  const language = request.vibeCheck.targetLanguage?.trim().toLowerCase() ?? 'english';
  const fallbackByLanguage: Record<string, string> = {
    danish: 'Fortæl mig lidt mere.',
    english: 'Okay, tell me more 👀',
    french: 'Dis-m’en un peu plus.',
    german: 'Erzähl mir ein bisschen mehr.',
    norwegian: 'Fortell meg litt mer.',
    spanish: 'Cuéntame un poco más.',
    swedish: 'Berätta lite mer.',
  };

  return {
    id: 'terminal-safe-fallback',
    text: getPlaceholderFallbackText(request) ?? fallbackByLanguage[language] ?? fallbackByLanguage.english,
    tone: request.selectedTone,
  };
}

export function getOwnershipCheckedReplies(
  replies: SuggestedReply[],
  request: RepliesRequest,
) {
  return replies.filter(
    (reply) => getReplyOwnershipIssues(reply.text, request).length === 0,
  ).slice(0, 1);
}
