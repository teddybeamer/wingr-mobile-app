import { getContextNotes } from './context-notes.ts';
import { getSuspiciousOcrTokens } from './transcript-cleanup.ts';
import type { RepliesRequest } from './types.ts';

export type MeFactKind = 'favorite' | 'hometown' | 'job' | 'looking_for' | 'plans';

export type ReplyAnswerability = {
  answerability: 'answerable_from_transcript' | 'not_applicable' | 'requires_user_knowledge';
  factKind?: MeFactKind;
  placeholder?: string;
  placeholderAllowed: boolean;
  requiresMeFact: boolean;
  requiresUnknownMeFact: boolean;
};

type RequestedMeFact = {
  factKind: MeFactKind;
  index: number;
  placeholder: string;
};

const BRACKETED_SLOT_PATTERN = /\[[^\[\]\n]{2,64}\]/gu;
const VAGUE_FAVORITE_SUBJECTS = new Set(['answer', 'something', 'stuff', 'thing']);

function normalizeLanguage(targetLanguage?: string) {
  return targetLanguage?.trim().toLowerCase() === 'danish' ? 'danish' : 'english';
}

function getLatestThemText(request: RepliesRequest) {
  const messages = request.parsedConversation?.messages ?? [];
  const latestThem = [...messages].reverse().find((message) => message.sender === 'them');

  if (latestThem?.text) {
    return latestThem.text;
  }

  return request.transcriptText
    .split('\n')
    .filter((line) => /^\s*(THEM|Them)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*(THEM|Them)\s*:\s*/i, ''))
    .pop() ?? '';
}

function getMeEvidence(request: RepliesRequest) {
  const notes = request.contextNotes ?? getContextNotes(request.extraContext);
  const messages = request.parsedConversation?.messages ?? [];
  const transcriptMeText = messages.length > 0
    ? messages.filter((message) => message.sender === 'me').map((message) => message.text)
    : request.transcriptText
      .split('\n')
      .filter((line) => /^\s*(ME|You)\s*:/i.test(line))
      .map((line) => line.replace(/^\s*(ME|You)\s*:\s*/i, ''));

  return [...transcriptMeText, ...(notes.userFacts ?? [])].join(' ');
}

function getFavoriteRequests(text: string, language: 'danish' | 'english') {
  const requests: RequestedMeFact[] = [];

  if (language === 'danish') {
    const pattern = /\bhvad\s+er\s+(dit|din|dine)\s+(yndlings[\p{L}\p{N}-]{2,30})\s*\?/giu;

    for (const match of text.matchAll(pattern)) {
      requests.push({
        factKind: 'favorite',
        index: match.index,
        placeholder: `[${match[1].toLowerCase()} ${match[2].toLowerCase()}]`,
      });
    }

    return requests;
  }

  const pattern = /\bwhat(?:['’]s| is)\s+your\s+(?:favorite|favourite)\s+([\p{L}\p{N}-]+(?:\s+[\p{L}\p{N}-]+){0,2})\s*\?/giu;

  for (const match of text.matchAll(pattern)) {
    const subject = match[1].toLowerCase().replace(/\s+/g, ' ').trim();

    if (
      !VAGUE_FAVORITE_SUBJECTS.has(subject) &&
      getSuspiciousOcrTokens(subject).length === 0
    ) {
      requests.push({
        factKind: 'favorite',
        index: match.index,
        placeholder: `[your favorite ${subject}]`,
      });
    }
  }

  return requests;
}

function getFixedRequests(text: string, language: 'danish' | 'english') {
  const definitions = language === 'danish'
    ? [
      { factKind: 'job' as const, pattern: /\bhvad\s+(?:laver|arbejder)\s+du\s+(?:med|som)(?:\s+til\s+daglig)?\s*\?/iu, placeholder: '[dit arbejde]' },
      { factKind: 'hometown' as const, pattern: /\bhvor\s+er\s+du\s+fra\s*\?/iu, placeholder: '[din hjemby]' },
      { factKind: 'plans' as const, pattern: /\bhvad\s+skal\s+du\s+(?:lave\s+)?(?:i\s+weekenden|i\s+aften|senere|i\s+morgen)\s*\?/iu, placeholder: '[dine planer]' },
      { factKind: 'looking_for' as const, pattern: /\bhvad\s+leder\s+du\s+efter\s*\?/iu, placeholder: '[det du leder efter]' },
    ]
    : [
      { factKind: 'job' as const, pattern: /\bwhat\s+do\s+you\s+do\s+for\s+work\s*\?/iu, placeholder: '[your job]' },
      { factKind: 'hometown' as const, pattern: /\bwhere\s+are\s+you\s+from\s*\?/iu, placeholder: '[your hometown]' },
      { factKind: 'plans' as const, pattern: /\bwhat\s+are\s+you\s+(?:doing|up\s+to)\s+(?:this\s+weekend|tonight|later|tomorrow)\s*\?/iu, placeholder: '[your plans]' },
      { factKind: 'looking_for' as const, pattern: /\bwhat\s+are\s+you\s+looking\s+for\s*\?/iu, placeholder: "[what you're looking for]" },
    ];

  return definitions.flatMap((definition) => {
    const match = definition.pattern.exec(text);

    return match?.index === undefined
      ? []
      : [{ factKind: definition.factKind, index: match.index, placeholder: definition.placeholder }];
  });
}

function getRequestedMeFact(request: RepliesRequest) {
  if (
    request.parsedConversation &&
    (
      request.parsedConversation.latestMessageSender !== 'them' ||
      request.parsedConversation.shouldGenerateDirectReply !== true
    )
  ) {
    return undefined;
  }

  if (!request.parsedConversation) {
    const latestLabeledLine = request.transcriptText
      .split('\n')
      .filter((line) => /^\s*(ME|You|THEM|Them)\s*:/i.test(line))
      .pop();

    if (latestLabeledLine && !/^\s*(THEM|Them)\s*:/i.test(latestLabeledLine)) {
      return undefined;
    }
  }

  const language = normalizeLanguage(request.vibeCheck.targetLanguage);
  const latestThemText = getLatestThemText(request);
  const requests = [
    ...getFavoriteRequests(latestThemText, language),
    ...getFixedRequests(latestThemText, language),
  ];

  return requests.sort((left, right) => right.index - left.index)[0];
}

function hasGroundedMeFact(factKind: MeFactKind, evidence: string) {
  const patterns: Record<MeFactKind, RegExp[]> = {
    favorite: [
      /\bmy\s+favou?rite\b[^.!?\n]{0,50}\b(?:is|would\s+be)\b/iu,
      /\b(?:is|would\s+be)\s+my\s+favou?rite\b/iu,
      /\b(?:mit|min|mine)\s+yndlings[\p{L}\p{N}-]*\b[^.!?\n]{0,50}\ber\b/iu,
      /\ber\s+(?:mit|min|mine)\s+yndlings/iu,
      /\b(?:i(?:['’]m| am)|jeg\s+er)\s+(?:really\s+|virkelig\s+)?obsessed\s+with\b/iu,
      /\b(?:jeg\s+er\s+)?(?:helt\s+)?(?:vild\s+med|besat\s+af)\b/iu,
    ],
    hometown: [
      /\bi(?:['’]m| am)\s+from\b/iu,
      /\bmy\s+hometown\b/iu,
      /\bjeg\s+er\s+fra\b/iu,
      /\bmin\s+hjemby\b/iu,
    ],
    job: [
      /\bi\s+work\s+(?:as|at|for|in)\b/iu,
      /\bmy\s+job\b/iu,
      /\bjeg\s+arbejder\s+(?:som|hos|for|i|med)\b/iu,
      /\bmit\s+arbejde\b/iu,
    ],
    looking_for: [
      /\bi(?:['’]m| am)\s+looking\s+for\b/iu,
      /\bjeg\s+leder\s+efter\b/iu,
    ],
    plans: [
      /\bi(?:['’]m| am)\s+(?:going|planning|meeting|seeing|working|visiting)\b/iu,
      /\bmy\s+plans?\b/iu,
      /\bjeg\s+skal\b/iu,
      /\bmine\s+planer\b/iu,
    ],
  };

  return patterns[factKind].some((pattern) => pattern.test(evidence));
}

export function getReplyAnswerability(request: RepliesRequest): ReplyAnswerability {
  const requestedMeFact = getRequestedMeFact(request);

  if (!requestedMeFact) {
    return {
      answerability: 'not_applicable',
      placeholderAllowed: false,
      requiresMeFact: false,
      requiresUnknownMeFact: false,
    };
  }

  if (hasGroundedMeFact(requestedMeFact.factKind, getMeEvidence(request))) {
    return {
      answerability: 'answerable_from_transcript',
      factKind: requestedMeFact.factKind,
      placeholderAllowed: false,
      requiresMeFact: true,
      requiresUnknownMeFact: false,
    };
  }

  return {
    answerability: 'requires_user_knowledge',
    factKind: requestedMeFact.factKind,
    placeholder: requestedMeFact.placeholder,
    placeholderAllowed: true,
    requiresMeFact: true,
    requiresUnknownMeFact: true,
  };
}

export function getReplyPlaceholders(replyText: string) {
  return replyText.match(BRACKETED_SLOT_PATTERN) ?? [];
}

export function hasAllowedReplyPlaceholder(
  replyText: string,
  answerability: ReplyAnswerability,
) {
  const placeholders = getReplyPlaceholders(replyText);

  return answerability.placeholderAllowed &&
    placeholders.length === 1 &&
    placeholders[0].toLowerCase() === answerability.placeholder?.toLowerCase();
}

export function hasInvalidReplyPlaceholder(
  replyText: string,
  answerability: ReplyAnswerability,
) {
  const placeholders = getReplyPlaceholders(replyText);
  const containsBracketSyntax = replyText.includes('[') || replyText.includes(']');

  return containsBracketSyntax &&
    (placeholders.length !== 1 || !hasAllowedReplyPlaceholder(replyText, answerability));
}

export function claimsUnknownMeFact(
  replyText: string,
  answerability: ReplyAnswerability,
) {
  if (!answerability.requiresUnknownMeFact || hasAllowedReplyPlaceholder(replyText, answerability)) {
    return false;
  }

  const claimPatterns: Record<MeFactKind, RegExp[]> = {
    favorite: [
      /\bmy\s+favou?rite\b[^.!?\n]{0,50}\b(?:is|would\s+be)\b/iu,
      /\bi(?:['’]d|\s+would)\s+(?:probably\s+)?(?:say|pick|choose)\b/iu,
      /\b(?:mit|min|mine)\s+yndlings[\p{L}\p{N}-]*\b[^.!?\n]{0,50}\ber\b/iu,
      /\bjeg\s+ville\s+(?:nok\s+)?(?:sige|vælge)\b/iu,
    ],
    hometown: [
      /\bi(?:['’]m| am)\s+from\b/iu,
      /\bmy\s+hometown\s+is\b/iu,
      /\bjeg\s+er\s+fra\b/iu,
      /\bmin\s+hjemby\s+er\b/iu,
    ],
    job: [
      /\bi\s+work\s+(?:as|at|for|in)\b/iu,
      /\bmy\s+job\s+is\b/iu,
      /\bjeg\s+arbejder\s+(?:som|hos|for|i|med)\b/iu,
      /\bmit\s+arbejde\s+er\b/iu,
    ],
    looking_for: [
      /\bi(?:['’]m| am)\s+looking\s+for\b/iu,
      /\bjeg\s+leder\s+efter\b/iu,
    ],
    plans: [
      /\bi(?:['’]m| am)\s+(?:going|planning|meeting|seeing|working|visiting)\b/iu,
      /\bmy\s+plans?\s+(?:are|would\s+be)\b/iu,
      /\bjeg\s+skal\b/iu,
      /\bmine\s+planer\s+er\b/iu,
    ],
  };

  return answerability.factKind
    ? claimPatterns[answerability.factKind].some((pattern) => pattern.test(replyText))
    : false;
}
