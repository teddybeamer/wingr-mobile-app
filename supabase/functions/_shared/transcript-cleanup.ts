const CHAT_TOKEN_ALLOWLIST = new Set([
  'HAHA',
  'HAHAH',
  'HAHAHA',
  'HEHE',
  'HEHEH',
  'HEHEHE',
  'HMMM',
  'LMAO',
  'LOL',
  'NOOO',
  'OMG',
  'OKAY',
  'YEAH',
  'YESS',
  'YESSS',
]);

function stripEdgePunctuation(token: string) {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function isLikelyOcrGarbageToken(token: string) {
  const stripped = stripEdgePunctuation(token);

  if (stripped.length < 5 || CHAT_TOKEN_ALLOWLIST.has(stripped.toUpperCase())) {
    return false;
  }

  const letters = stripped.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = stripped.match(/\p{Lu}/gu) ?? [];
  const digits = stripped.match(/\p{N}/gu) ?? [];
  const hasLowercase = /\p{Ll}/u.test(stripped);
  const hasNonAscii = /[^\x00-\x7F]/.test(stripped);
  const hasLatin = /\p{Script=Latin}/u.test(stripped);
  const hasNonLatinLetter = /\p{L}/u.test(stripped.replace(/\p{Script=Latin}/gu, ''));
  const hasSymbolNoise = /[^\p{L}\p{N}'’-]/u.test(stripped);
  const letterRatio = letters.length / stripped.length;
  const uppercaseRatio = uppercaseLetters.length / Math.max(letters.length, 1);
  const digitRatio = digits.length / stripped.length;

  if (letters.length === 0) {
    return true;
  }

  if (!hasLowercase && letterRatio >= 0.75 && uppercaseRatio >= 0.85) {
    return true;
  }

  if (hasLatin && hasNonLatinLetter && !hasLowercase && stripped.length >= 5) {
    return true;
  }

  if (hasNonAscii && hasSymbolNoise && stripped.length >= 5) {
    return true;
  }

  return digitRatio > 0.35 && hasSymbolNoise;
}

export function cleanTranscriptForAi(transcriptText: string) {
  return transcriptText
    .split('\n')
    .map((line) =>
      line
        .split(/\s+/)
        .filter((token) => !isLikelyOcrGarbageToken(token))
        .join(' ')
        .replace(/\s+([?.!,])/g, '$1')
        .trim(),
    )
    .filter((line) => {
      const withoutSpeaker = line.replace(/^\s*(ME|THEM|UNKNOWN|You|Them|Unknown)\s*:\s*/i, '').trim();

      return withoutSpeaker.length > 0;
    })
    .join('\n');
}

export function getSuspiciousOcrTokens(transcriptText: string) {
  return [
    ...new Set(
      transcriptText
        .split(/\s+/)
        .map(stripEdgePunctuation)
        .filter(Boolean)
        .filter(isLikelyOcrGarbageToken),
    ),
  ];
}
