// Offline heuristic for benchmark reports: does the reply use a different language
// than the vibe check text fields? A rough English/Danish stop-word vote, used only
// to flag candidates for manual review. It never runs in the Edge Function.

const DANISH = new Set(
  "og er det du at jeg har ikke med en til for på de der som vi men kan så hvad din dig mig han hun lyder ud om af den et var bliver kunne godt rigtig lidt også mødes".split(" "),
);
const ENGLISH = new Set(
  "the and you is to of that it in for are with he she they their your this on be as have was but what at an so not can like just them his her about".split(" "),
);

export function guessLanguage(text: string): "da" | "en" | "unknown" {
  const words = text.toLowerCase().match(/[a-zæøå']+/g) ?? [];
  const danish = words.filter((word) => DANISH.has(word)).length;
  const english = words.filter((word) => ENGLISH.has(word)).length;
  return danish > english ? "da" : english > danish ? "en" : "unknown";
}

/** True when the reply and the vibe text fields clearly use different languages. */
export function hasMixedLanguages(texts: string[]) {
  const known = new Set(texts.map(guessLanguage).filter((language) => language !== "unknown"));
  return known.size > 1;
}
