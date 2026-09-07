import { getContextNotes } from './context-notes.ts';
import type { RepliesRequest } from './types.ts';

export type ReplyFactOwner = 'me' | 'them';

export type ReplyFactProvenance =
  | {
    messageId: string;
    messageIndex: number;
    source: 'structured_message';
  }
  | {
    factIndex: number;
    source: 'them_fact' | 'user_fact';
  };

export type ReplyFactLedgerEntry = {
  confidence: number;
  normalizedValue: string;
  owner: ReplyFactOwner;
  provenance: ReplyFactProvenance;
};

export type ReplyFactLedger = {
  facts: ReplyFactLedgerEntry[];
};

export type ReplyFactLedgerValidation = {
  factOwnerReversalDetected: boolean;
  unsupportedMeFactDetected: boolean;
};

type ExtractedFact = {
  confidence: number;
  normalizedValue: string;
  terms: string[];
};

const FACT_TERM_STOPWORDS = new Set([
  'a', 'actually', 'also', 'am', 'an', 'and', 'are', 'at', 'been', 'being',
  'currently', 'det', 'du', 'en', 'er', 'faktisk',
  'et', 'for', 'fra', 'from', 'had', 'har', 'has', 'have', 'having', 'i', 'in', 'is',
  'it', 'jeg', 'just', 'lige', 'med', 'min', 'mine', 'mit', 'my', 'of', 'og',
  'også', 'on', 'our', 'på', 'really',
  'som', 'that', 'the', 'their', 'them', 'they', 'this', 'til', 'to', 'var', 'was',
  'we', 'were', 'with', 'you', 'your',
]);

const ENGLISH_DISCOURSE_VERBS = new Set([
  'agree', 'bet', 'choose', 'choosing', 'enjoying', 'feel', 'feeling', 'guess',
  'hope', 'imagine', 'joke', 'know', 'looking', 'love', 'loving', 'mean', 'need',
  'say', 'think', 'trying', 'waiting', 'wonder',
]);
const ENGLISH_CONCRETE_VERBS = new Set([
  'ate', 'cook', 'cooked', 'eat', 'go', 'live', 'lived', 'meet', 'met', 'own',
  'play', 'played', 'spend', 'spent', 'study', 'studied', 'train', 'trained',
  'travel', 'traveled', 'travelled', 'visit', 'visited', 'went', 'work', 'worked',
]);
const DANISH_DISCOURSE_VERBS = new Set([
  'forestiller', 'gætter', 'håber', 'mener', 'siger', 'synes', 'tænker', 'ved',
]);
const DANISH_CONCRETE_VERBS = new Set([
  'arbejder', 'arbejdede', 'besøger', 'besøgte', 'boede', 'bor', 'ejer', 'gik',
  'laver', 'lavede', 'møder', 'mødte', 'rejser', 'rejste', 'spiller', 'spillede',
  'spiser', 'spiste', 'tog', 'træner', 'trænede',
]);
const UNCERTAIN_MARKER_PATTERN =
  /\b(?:apparently|could|guess|maybe|might|perhaps|probably|seems?|would|måske|nok|kunne|virker|ville)\b/iu;
const LEADING_ADVERBS = new Set([
  'actually', 'also', 'currently', 'faktisk', 'just', 'lige', 'også', 'really',
]);

function normalizeText(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function singularize(term: string) {
  if (term.length > 4 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith('s') && !term.endsWith('ss')) return term.slice(0, -1);
  return term;
}

function getFactTerms(text: string) {
  return normalizeText(text)
    .split(' ')
    .map(singularize)
    .filter((term) =>
      (term.length > 1 || /^\d+$/u.test(term)) && !FACT_TERM_STOPWORDS.has(term)
    );
}

function makeExtractedFact(text: string, confidence: number): ExtractedFact | undefined {
  const terms = getFactTerms(text);

  if (terms.length === 0) return undefined;

  return {
    confidence,
    normalizedValue: terms.join(' '),
    terms,
  };
}

function expandFirstPersonContractions(text: string) {
  return text
    .replace(/\bi[’']m\b/giu, 'i am')
    .replace(/\bi[’']ve\b/giu, 'i have')
    .replace(/\bi[’']d\b/giu, 'i would')
    .replace(/\bwe[’']re\b/giu, 'we are')
    .replace(/\bwe[’']ve\b/giu, 'we have')
    .replace(/\bwe[’']d\b/giu, 'we would');
}

function isConcreteEnglishBody(body: string) {
  const words = normalizeText(body).split(' ').filter(Boolean);
  while (words[0] && LEADING_ADVERBS.has(words[0])) words.shift();
  const first = words[0];
  const second = words[1];

  if (!first || UNCERTAIN_MARKER_PATTERN.test(body)) return false;

  if (['would', 'could', 'might', 'may', 'should'].includes(first)) return false;

  if (['am', 'are', 'was', 'were'].includes(first)) {
    if (!second) return false;
    if (['from', 'in', 'at', 'on', 'with'].includes(second)) return getFactTerms(body).length >= 1;
    return second.endsWith('ing') &&
      !ENGLISH_DISCOURSE_VERBS.has(second) &&
      getFactTerms(body).length >= 2;
  }

  if (['have', 'had', 'own', 'got'].includes(first)) {
    if (second === 'to' || /\b(?:no idea|a question|to (?:admit|ask|say))\b/iu.test(body)) {
      return false;
    }
    return getFactTerms(body).length >= 1;
  }

  return ENGLISH_CONCRETE_VERBS.has(first) && getFactTerms(body).length >= 2;
}

function isConcreteDanishBody(body: string) {
  const words = normalizeText(body).split(' ').filter(Boolean);
  while (words[0] && LEADING_ADVERBS.has(words[0])) words.shift();
  const first = words[0];
  const second = words[1];

  if (!first || UNCERTAIN_MARKER_PATTERN.test(body)) return false;
  if (['ville', 'kunne', 'burde'].includes(first)) return false;

  if (['er', 'var'].includes(first)) {
    return Boolean(second) &&
      ['fra', 'i', 'på', 'hos', 'med'].includes(second) &&
      getFactTerms(body).length >= 1;
  }

  if (['har', 'havde', 'ejer'].includes(first)) {
    return getFactTerms(body).length >= 1;
  }

  return DANISH_CONCRETE_VERBS.has(first) &&
    !DANISH_DISCOURSE_VERBS.has(first) &&
    getFactTerms(body).length >= 2;
}

function extractClearFirstPersonFacts(text: string): ExtractedFact[] {
  if (text.includes('[') || text.includes(']')) return [];

  const expanded = expandFirstPersonContractions(text);
  const facts: ExtractedFact[] = [];
  const firstPersonPattern = /\b(i|we|jeg|vi)\s+([^.!?\n]{2,140})/giu;

  for (const match of expanded.matchAll(firstPersonPattern)) {
    const pronoun = match[1].toLowerCase();
    const body = match[2].trim();
    const concrete = pronoun === 'i' || pronoun === 'we'
      ? isConcreteEnglishBody(body)
      : isConcreteDanishBody(body);

    if (!concrete) continue;

    const fact = makeExtractedFact(body, 0.95);
    if (fact) facts.push(fact);
  }

  const possessivePattern = /\b(my|our|min|mit|mine|vores)\s+([^.!?\n]{2,120})/giu;

  for (const match of expanded.matchAll(possessivePattern)) {
    const fact = makeExtractedFact(match[2], 0.95);
    if (fact && fact.terms.length >= 2 && !UNCERTAIN_MARKER_PATTERN.test(match[2])) {
      facts.push(fact);
    }
  }

  return facts;
}

function getEntryTerms(entry: ReplyFactLedgerEntry) {
  return entry.normalizedValue.split(' ').filter(Boolean);
}

function countOverlap(left: string[], right: string[]) {
  const unmatched = [...right];

  return left.reduce((count, term) => {
    const matchIndex = unmatched.findIndex((candidate) =>
      term === candidate ||
      (term.length >= 5 && candidate.length >= 5 &&
        (term.startsWith(candidate) || candidate.startsWith(term)))
    );

    if (matchIndex < 0) return count;
    unmatched.splice(matchIndex, 1);
    return count + 1;
  }, 0);
}

function hasStrongMatch(claim: ExtractedFact, entry: ReplyFactLedgerEntry) {
  const entryTerms = getEntryTerms(entry);
  const overlap = countOverlap(claim.terms, entryTerms);

  if (overlap === 0) return false;
  if (claim.normalizedValue === entry.normalizedValue) return true;

  return overlap >= 2 &&
    overlap / claim.terms.length >= 0.75 &&
    overlap / entryTerms.length >= 0.6;
}

function hasAnyOverlap(claim: ExtractedFact, entry: ReplyFactLedgerEntry) {
  return countOverlap(claim.terms, getEntryTerms(entry)) > 0;
}

export function buildReplyFactLedger(request: RepliesRequest): ReplyFactLedger {
  const notes = request.contextNotes ?? getContextNotes(request.extraContext);
  const facts: ReplyFactLedgerEntry[] = [];

  request.parsedConversation?.messages.forEach((message, messageIndex) => {
    const owner = message.sender === 'me' ? 'me' : message.sender === 'them' ? 'them' : undefined;
    const speakerMatches = owner === 'me'
      ? message.speaker === 'user'
      : owner === 'them'
        ? message.speaker === 'other'
        : false;

    if (!owner || !speakerMatches) return;

    extractClearFirstPersonFacts(message.text).forEach((fact) => {
      facts.push({
        confidence: Math.min(message.confidence, fact.confidence),
        normalizedValue: fact.normalizedValue,
        owner,
        provenance: {
          messageId: message.id,
          messageIndex,
          source: 'structured_message',
        },
      });
    });
  });

  const addContextFacts = (
    values: string[],
    owner: ReplyFactOwner,
    source: 'them_fact' | 'user_fact',
  ) => {
    values.forEach((value, factIndex) => {
      const fact = makeExtractedFact(value, 0.95);
      if (!fact) return;

      facts.push({
        confidence: fact.confidence,
        normalizedValue: fact.normalizedValue,
        owner,
        provenance: { factIndex, source },
      });
    });
  };

  addContextFacts(notes.userFacts ?? [], 'me', 'user_fact');
  addContextFacts(notes.themFacts ?? [], 'them', 'them_fact');

  return { facts };
}

export function validateReplyAgainstFactLedger(
  replyText: string,
  ledger: ReplyFactLedger,
): ReplyFactLedgerValidation {
  const reliableFacts = ledger.facts.filter((fact) => fact.confidence >= 0.8);
  const meFacts = reliableFacts.filter((fact) => fact.owner === 'me');
  const themFacts = reliableFacts.filter((fact) => fact.owner === 'them');
  let factOwnerReversalDetected = false;
  let unsupportedMeFactDetected = false;

  extractClearFirstPersonFacts(replyText).forEach((claim) => {
    if (meFacts.some((fact) => hasStrongMatch(claim, fact))) return;

    const overlapsMe = meFacts.some((fact) => hasAnyOverlap(claim, fact));
    const stronglyMatchesThem = themFacts.some((fact) =>
      getEntryTerms(fact).length >= 2 && hasStrongMatch(claim, fact)
    );

    if (stronglyMatchesThem && !overlapsMe) {
      factOwnerReversalDetected = true;
      return;
    }

    const overlapsKnownFact = ledger.facts.some((fact) => hasAnyOverlap(claim, fact));
    if (!overlapsKnownFact && claim.confidence >= 0.9) {
      unsupportedMeFactDetected = true;
    }
  });

  return {
    factOwnerReversalDetected,
    unsupportedMeFactDetected,
  };
}
