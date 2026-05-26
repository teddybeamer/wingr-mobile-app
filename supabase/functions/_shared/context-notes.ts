import type { ContextNotes } from './types.ts';

const EMPTY_CONTEXT_NOTES: ContextNotes = {
  replyInstruction: [],
  situationNotes: [],
  themFacts: [],
  userFacts: [],
};

function normalizeContextText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function removeOwnershipClarifiers(text: string) {
  return normalizeContextText(
    text.replace(/\((?:the\s+one\s+)?(?:i'm|i’m|im|i am)\s+(?:talking|chatting|texting)\s+to\)/gi, ''),
  );
}

function splitContextClauses(context: string) {
  return context
    .split(/[\n.;]+/)
    .map(normalizeContextText)
    .flatMap(splitInstructionTail)
    .filter(Boolean);
}

function splitInstructionTail(clause: string) {
  const match = clause.match(/\b(try to|please|mention|ask|avoid|don't|do not|keep|make it|say|use)\b/i);

  if (!match?.index || match.index < 4) {
    return [clause];
  }

  return [clause.slice(0, match.index), clause.slice(match.index)].map(normalizeContextText);
}

function hasFirstPersonOwnership(text: string) {
  return /\b(i|i'm|i’m|im|i've|i’ve|ive|i'll|i’ll|ill|me|my|mine|myself)\b/i.test(text);
}

function hasOtherPersonOwnership(text: string) {
  return /\b(they|them|their|theirs|themselves|he|him|his|she|her|hers)\b/i.test(text);
}

function looksLikeReplyInstruction(text: string) {
  return (
    /\b(try to|please|mention|bring up|ask|avoid|don't|do not|keep|make it|say|use|reply|respond)\b/i.test(text) ||
    /\b(playful|direct|casual|flirty|funny|confident|low pressure)\b/i.test(text)
  );
}

function looksLikeSituationNote(text: string) {
  return (
    /\b(conversation|chat|screenshot|situation|hinge|tinder|bumble|app|matched|match|date|plans?|tonight|tomorrow|yesterday|days?|weeks?|hours?|replied|reply|message)\b/i.test(
      text,
    ) ||
    /\b(we|us|our)\b/i.test(text)
  );
}

function addUnique(target: string[], value: string) {
  if (!target.includes(value)) {
    target.push(value);
  }
}

export function getContextNotes(extraContext?: string): ContextNotes {
  if (!extraContext?.trim()) {
    return EMPTY_CONTEXT_NOTES;
  }

  const notes: ContextNotes = {
    replyInstruction: [],
    situationNotes: [],
    themFacts: [],
    userFacts: [],
  };

  splitContextClauses(extraContext).forEach((clause) => {
    const cleanedClause = removeOwnershipClarifiers(clause);

    if (!cleanedClause) {
      return;
    }

    if (looksLikeReplyInstruction(cleanedClause)) {
      addUnique(notes.replyInstruction, cleanedClause);
      return;
    }

    if (hasOtherPersonOwnership(cleanedClause)) {
      addUnique(notes.themFacts, cleanedClause);
      return;
    }

    if (hasFirstPersonOwnership(cleanedClause)) {
      addUnique(notes.userFacts, cleanedClause);
      return;
    }

    if (looksLikeSituationNote(cleanedClause)) {
      addUnique(notes.situationNotes, cleanedClause);
      return;
    }

    addUnique(notes.themFacts, cleanedClause);
  });

  return notes;
}
