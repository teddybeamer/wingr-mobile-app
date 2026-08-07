import type {
  DetectedMessage,
  MessageSender,
  ParsedConversation,
  SuggestedReply,
  VibeCheck,
} from './types.ts';

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

const LANGUAGE_NEUTRAL_TOKENS = new Set([
  'haha',
  'hahaha',
  'hehe',
  'hehehe',
  'lol',
  'lmao',
  'omg',
  'ok',
  'okay',
  'k',
  'kk',
  'yeah',
  'yep',
  'yes',
  'no',
  'nah',
]);

type MessageLanguageSignal = {
  contentWeight: number;
  sender: MessageSender;
  tag: string;
};

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

function normalizeLanguageTag(tag: string) {
  const candidate = tag.trim().replace(/_/g, '-');

  if (!candidate || candidate.toLowerCase() === 'und') {
    return null;
  }

  try {
    return new Intl.Locale(candidate).language;
  } catch {
    return null;
  }
}

function getLanguageDisplayName(tag: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function getMessageLanguageTag(message: DetectedMessage) {
  const counts = new Map<string, number>();

  for (const evidence of message.languageEvidence ?? []) {
    const tag = normalizeLanguageTag(evidence.tag);

    if (tag && evidence.lineCount > 0) {
      counts.set(tag, (counts.get(tag) ?? 0) + evidence.lineCount);
    }
  }

  const ranked = [...counts.entries()].sort(
    (first, second) => second[1] - first[1] || first[0].localeCompare(second[0]),
  );
  const [topTag, topLineCount] = ranked[0] ?? [];
  const [, secondLineCount = 0] = ranked[1] ?? [];

  if (!topTag || topLineCount === secondLineCount) {
    return null;
  }

  return { lineCount: topLineCount, tag: topTag };
}

function getMessageLanguageContentWeight(text: string, lineCount: number) {
  const withoutUrls = text.replace(/https?:\/\/\S+|www\.\S+/gi, ' ').trim();
  const words = getWordTokens(withoutUrls);

  if (words.length === 0) {
    return 0;
  }

  const isNeutralPhrase = words.every((word) => LANGUAGE_NEUTRAL_TOKENS.has(word));
  const isVeryShort = words.length <= 2;
  const lowSignal = isNeutralPhrase || isVeryShort;

  if (!lowSignal) {
    return 1;
  }

  return lineCount >= 2 ? 1 : 0.2;
}

function getMessageLanguageSignals(parsedConversation?: ParsedConversation) {
  return (parsedConversation?.messages ?? [])
    .filter((message) => message.sender === 'me' || message.sender === 'them')
    .flatMap((message): MessageLanguageSignal[] => {
      const language = getMessageLanguageTag(message);

      if (!language) {
        return [];
      }

      const contentWeight = getMessageLanguageContentWeight(
        message.text,
        language.lineCount,
      );

      return contentWeight > 0
        ? [{ contentWeight, sender: message.sender, tag: language.tag }]
        : [];
    });
}

function getWeightedLanguageMajority(signals: MessageLanguageSignal[]) {
  const substantiveSignals = signals.filter((signal) => signal.contentWeight === 1);

  if (substantiveSignals.length < 2) {
    return null;
  }

  const recentSignals = new Set(substantiveSignals.slice(-6));
  const weights = new Map<string, number>();

  for (const signal of signals) {
    const recencyWeight = recentSignals.has(signal) ? 3 : 1;
    weights.set(signal.tag, (weights.get(signal.tag) ?? 0) + signal.contentWeight * recencyWeight);
  }

  const ranked = [...weights.entries()].sort(
    (first, second) => second[1] - first[1] || first[0].localeCompare(second[0]),
  );
  const [topTag, topWeight] = ranked[0] ?? [];
  const totalWeight = [...weights.values()].reduce((total, weight) => total + weight, 0);

  return topTag && totalWeight > 0 && topWeight / totalWeight >= 0.65 ? topTag : null;
}

function getRecentLanguageTransition(signals: MessageLanguageSignal[]) {
  const recentSubstantiveSignals = signals
    .filter((signal) => signal.contentWeight === 1)
    .slice(-4);

  if (recentSubstantiveSignals.length !== 4) {
    return null;
  }

  const [firstSignal] = recentSubstantiveSignals;

  return recentSubstantiveSignals.every((signal) => signal.tag === firstSignal.tag)
    ? firstSignal.tag
    : null;
}

function getLatestThemLanguageTieBreaker(signals: MessageLanguageSignal[]) {
  return [...signals]
    .reverse()
    .find((signal) => signal.sender === 'them' && signal.contentWeight === 1)
    ?.tag;
}

export function resolveConversationLanguage(parsedConversation?: ParsedConversation) {
  const signals = getMessageLanguageSignals(parsedConversation);
  const tag =
    getWeightedLanguageMajority(signals) ??
    getRecentLanguageTransition(signals) ??
    getLatestThemLanguageTieBreaker(signals);

  return tag ? getLanguageDisplayName(tag) : undefined;
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
