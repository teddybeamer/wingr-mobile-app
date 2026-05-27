import type { SuggestedReply, VibeCheck } from './types.ts';

const COMMON_ENGLISH_WORDS = new Set([
  'a',
  'about',
  'actually',
  'and',
  'are',
  'be',
  'but',
  'can',
  'did',
  'do',
  'for',
  'from',
  'going',
  'good',
  'got',
  'had',
  'have',
  'how',
  'i',
  "i'd",
  "i'll",
  "i'm",
  "i've",
  'if',
  'in',
  'is',
  'it',
  "it's",
  'like',
  'me',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'up',
  'want',
  'what',
  'when',
  'with',
  'would',
  'you',
  "you're",
  'your',
]);

const DANISH_MARKERS = [
  'af',
  'at',
  'bare',
  'blev',
  'bliver',
  'da',
  'de',
  'dejlig',
  'den',
  'der',
  'det',
  'dig',
  'du',
  'eller',
  'en',
  'er',
  'et',
  'fik',
  'for',
  'fra',
  'godt',
  'har',
  'havde',
  'hej',
  'hvad',
  'hvem',
  'hvor',
  'ikke',
  'jeg',
  'kan',
  'kunne',
  'lige',
  'lidt',
  'man',
  'med',
  'men',
  'mig',
  'min',
  'måske',
  'ned',
  'noget',
  'nu',
  'når',
  'og',
  'om',
  'op',
  'på',
  'så',
  'til',
  'var',
  'ved',
  'vi',
  'vil',
  'ville',
  'æ',
  'ø',
  'å',
];

function normalizeLanguageName(language?: string) {
  return language?.trim().toLowerCase() ?? '';
}

function isTargetingEnglish(language?: string) {
  const normalized = normalizeLanguageName(language);

  return !normalized || normalized === 'english' || normalized === 'en';
}

function getWordTokens(text: string) {
  return text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
}

function looksMostlyEnglish(text: string) {
  const tokens = getWordTokens(text);

  if (tokens.length < 4) {
    return false;
  }

  const commonEnglishCount = tokens.filter((token) => COMMON_ENGLISH_WORDS.has(token)).length;

  return commonEnglishCount >= 3 && commonEnglishCount / tokens.length >= 0.32;
}

function looksDanish(text: string) {
  const normalized = text.toLowerCase();
  const tokens = getWordTokens(text);

  return (
    /[æøå]/i.test(normalized) ||
    tokens.filter((token) => DANISH_MARKERS.includes(token)).length >= 2
  );
}

export function inferTranscriptLanguage(transcriptText: string) {
  if (looksDanish(transcriptText)) {
    return 'Danish';
  }

  return undefined;
}

export function normalizeVibeCheckLanguage(vibeCheck: VibeCheck, transcriptText: string): VibeCheck {
  return {
    ...vibeCheck,
    targetLanguage: vibeCheck.targetLanguage?.trim() || inferTranscriptLanguage(transcriptText) || 'English',
  };
}

export function repliesLookWrongLanguage(replies: SuggestedReply[], vibeCheck: VibeCheck) {
  if (isTargetingEnglish(vibeCheck.targetLanguage)) {
    return false;
  }

  const joinedReplies = replies.map((reply) => reply.text).join(' ');

  if (normalizeLanguageName(vibeCheck.targetLanguage) === 'danish') {
    return looksMostlyEnglish(joinedReplies) && !looksDanish(joinedReplies);
  }

  return looksMostlyEnglish(joinedReplies);
}

