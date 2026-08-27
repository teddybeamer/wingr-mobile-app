import { getContextNotes } from './context-notes.ts';
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
  meFactDirectedAtThemRejected: boolean;
  rejectionCodes: ReplyOwnershipRejectionCode[];
  rejectedReplyCount: number;
};

export type ReplyOwnershipRejectionCode =
  | 'me_fact_directed_at_them'
  | 'ownership_or_grounding';

function getReplyOwnershipRejectionCodes(
  replies: SuggestedReply[],
  request: RepliesRequest,
): ReplyOwnershipRejectionCode[] {
  const issues = replies.flatMap((reply) => getReplyOwnershipIssues(reply.text, request));
  const codes = new Set<ReplyOwnershipRejectionCode>();

  if (issues.includes('Reply asks the other person about a fact established only for the user.')) {
    codes.add('me_fact_directed_at_them');
  }

  if (issues.length > 0 && codes.size === 0) {
    codes.add('ownership_or_grounding');
  }

  return [...codes];
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
  const suspiciousReplyTokens = getSuspiciousOcrTokens(replyText);

  if (suspiciousReplyTokens.length > 0) {
    issues.push('Reply includes random OCR-looking or model-noise tokens.');
  }

  if (hasUnsupportedPetClaim(replyText, notes, request.transcriptText)) {
    issues.push('Reply implies the user owns or loves a pet without user evidence.');
  }

  if (hasUnsupportedKeywordOwnership(replyText, notes, request.transcriptText)) {
    issues.push('Reply turns a fact about the other person into a user-owned claim.');
  }

  if (asksOtherPersonAboutMeOnlyFact(replyText, request)) {
    issues.push('Reply asks the other person about a fact established only for the user.');
  }

  const addressedName = getUnsupportedDirectAddress(replyText, request.transcriptText);

  if (addressedName) {
    issues.push('Reply directly addresses a name that does not appear in the chat.');
  }

  if (getUnsupportedProperName(replyText, request.transcriptText)) {
    issues.push('Reply includes a proper name that does not appear in the chat.');
  }

  const latestOtherText = getLatestOtherText(request);

  if (THANKS_PATTERN.test(replyText) && !THANKS_WORTHY_OTHER_PATTERN.test(latestOtherText)) {
    issues.push('Reply thanks the other person without a thanks-worthy latest other message.');
  }

  if (request.parsedConversation?.shouldGenerateDirectReply === false && THANKS_PATTERN.test(replyText)) {
    issues.push('Reply appears to answer the user’s own latest message.');
  }

  if (USER_SAID_PERSPECTIVE_PATTERN.test(replyText) || OTHER_PERSON_PERSPECTIVE_PATTERN.test(replyText)) {
    issues.push('Reply switches perspective or describes the wrong speaker role.');
  }

  return issues;
}

export function getReplyOwnershipValidationTrace(
  replies: SuggestedReply[],
  request: RepliesRequest,
): ReplyOwnershipValidationTrace {
  const issueLists = replies.map((reply) => getReplyOwnershipIssues(reply.text, request));
  const acceptedReplyCount = issueLists.filter((issues) => issues.length === 0).length;

  return {
    acceptedReplyCount,
    checkedReplyCount: replies.length,
    meFactDirectedAtThemRejected: issueLists.some((issues) =>
      issues.includes('Reply asks the other person about a fact established only for the user.'),
    ),
    rejectionCodes: getReplyOwnershipRejectionCodes(replies, request),
    rejectedReplyCount: replies.length - acceptedReplyCount,
  };
}

function getFallbackLanguage(targetLanguage?: string) {
  return targetLanguage?.trim().toLowerCase() ?? 'english';
}

function getFallbackReplies(request: RepliesRequest): SuggestedReply[] {
  const notes = normalizeNotes(request);
  const language = getFallbackLanguage(request.vibeCheck.targetLanguage);

  if (contextMentionsPets(notes)) {
    const petFallbackByLanguage: Record<string, string> = {
      danish: 'Det lyder som en historie om din hund — hvad er den seneste?',
      english: 'That detail deserves a dog story. What is the latest one?',
    };

    return [
      {
        id: 'ownership-safe-dog-1',
        text: petFallbackByLanguage[language] ?? petFallbackByLanguage.english,
        tone: request.selectedTone,
      },
    ];
  }

  const fallbackByLanguage: Record<string, Record<RepliesRequest['selectedTone'], string>> = {
    danish: {
      casualSmallTalk: 'Måske... hvad tænker du på?',
      direct: 'Har du noget i tankerne?',
      playful: 'Pas på, det lyder som et forslag 👀',
    },
    english: {
      casualSmallTalk: 'Could be... what are you thinking?',
      direct: 'Got something in mind?',
      playful: 'Careful, that sounds like a suggestion 👀',
    },
    french: {
      casualSmallTalk: 'Peut-être... tu as une idée en tête ?',
      direct: 'Tu as quelque chose en tête ?',
      playful: 'Attention, ça ressemble à une proposition 👀',
    },
    german: {
      casualSmallTalk: 'Vielleicht... was schwebt dir vor?',
      direct: 'Hast du etwas im Sinn?',
      playful: 'Vorsicht, das klingt nach einem Vorschlag 👀',
    },
    norwegian: {
      casualSmallTalk: 'Kanskje... hva tenker du på?',
      direct: 'Har du noe i tankene?',
      playful: 'Forsiktig, det høres ut som et forslag 👀',
    },
    spanish: {
      casualSmallTalk: 'Puede ser... ¿qué tienes en mente?',
      direct: '¿Tienes algo en mente?',
      playful: 'Cuidado, eso suena a propuesta 👀',
    },
    swedish: {
      casualSmallTalk: 'Kanske... vad tänker du på?',
      direct: 'Har du något i åtanke?',
      playful: 'Försiktigt, det låter som ett förslag 👀',
    },
  };
  const fallbackByTone = fallbackByLanguage[language] ?? fallbackByLanguage.english;

  return [{
    id: `ownership-safe-context-${request.selectedTone}`,
    text: fallbackByTone[request.selectedTone],
    tone: request.selectedTone,
  }];
}

export function getOwnershipCheckedReplies(
  replies: SuggestedReply[],
  request: RepliesRequest,
) {
  return replies.filter(
    (reply) => getReplyOwnershipIssues(reply.text, request).length === 0,
  ).slice(0, 1);
}

export function getOwnershipSafeReplies(replies: SuggestedReply[], request: RepliesRequest) {
  const safeReplies = getOwnershipCheckedReplies(replies, request);

  if (safeReplies.length >= 1) {
    return safeReplies.slice(0, 1);
  }

  const fallbackReplies = getFallbackReplies(request).filter(
    (reply) => getReplyOwnershipIssues(reply.text, request).length === 0,
  );

  return [...safeReplies, ...fallbackReplies].slice(0, 1);
}
