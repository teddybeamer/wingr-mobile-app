import { getContextNotes } from './context-notes.ts';
import type { ContextNotes, RepliesRequest, SuggestedReply, VibeCheck, VibeCheckRequest } from './types.ts';

export const vibeCheckSchema = {
  additionalProperties: false,
  properties: {
    bestTone: {
      enum: ['direct', 'playful', 'casualSmallTalk'],
      type: 'string',
    },
    conversationEnergy: {
      description: 'Short description of the current texting energy.',
      type: 'string',
    },
    interestLevel: {
      enum: ['Low', 'Medium', 'High', 'Unclear'],
      type: 'string',
    },
    risk: {
      description: 'A concise warning about what to avoid in the next reply.',
      type: 'string',
    },
    summary: {
      description: 'A concise, user-friendly summary of the vibe.',
      type: 'string',
    },
  },
  required: ['interestLevel', 'conversationEnergy', 'bestTone', 'risk', 'summary'],
  type: 'object',
} as const;

export const repliesSchema = {
  additionalProperties: false,
  properties: {
    replies: {
      items: {
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          tone: {
            enum: ['sound_more_like_me', 'direct', 'playful', 'casualSmallTalk'],
            type: 'string',
          },
        },
        required: ['id', 'tone', 'text'],
        type: 'object',
      },
      maxItems: 2,
      minItems: 2,
      type: 'array',
    },
  },
  required: ['replies'],
  type: 'object',
} as const;

export function buildVibeCheckPrompt({ extraContext, transcriptText }: VibeCheckRequest) {
  return [
    'Analyze this dating chat transcript for Wingr.',
    'Return a vibe check for the user deciding how to reply next.',
    'Rules:',
    '- bestTone must be exactly one of: direct, playful, casualSmallTalk',
    '- Focus on the emotional dynamics of the transcript, not generic dating advice.',
    '- Keep conversationEnergy, risk, and summary concise and readable in a mobile UI.',
    extraContext ? `Extra context: ${extraContext}` : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildRepliesPrompt({
  contextNotes,
  extraContext,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: RepliesRequest) {
  const notes = normalizeContextNotes(contextNotes ?? getContextNotes(extraContext));

  return [
    'Generate exactly two reply suggestions for the user in this dating chat.',
    `Selected tone: ${selectedTone}`,
    userStylePreference?.howTheyText
      ? `Saved user style preference: ${userStylePreference.howTheyText}`
      : '',
    `Vibe check summary: ${vibeCheck.summary}`,
    `Interest level: ${vibeCheck.interestLevel}`,
    `Conversation energy: ${vibeCheck.conversationEnergy}`,
    `Risk to avoid: ${vibeCheck.risk}`,
    formatContextNotes(notes),
    'Rules:',
    '- Return exactly two replies.',
    '- Keep each reply flirty, concise, and realistic to send.',
    '- Avoid over-investing.',
    '- The tone field on each reply must match the selected tone.',
    '- Context ownership is strict: userFacts are about the user; themFacts are about the other person.',
    '- Do not claim the user likes, feels, has done, or has experienced anything unless it appears in userFacts or the transcript.',
    '- If a themFact is useful, reference it as something relevant to the other person, not as the user owning that fact.',
    '- Use themFacts as light hooks for a question or playful observation. Do not turn them into a made-up personal anecdote.',
    '- Do not invent pets, roommates, weekend plans, routines, hobbies, favorite places, or matching interests for the user.',
    '- If themFacts mention dogs or pets, do not write "my dog", "my pup", "my furry roommate", or "I love dogs too" unless userFacts or the user transcript explicitly says that.',
    '- A safe dog mention is a casual question like "Important question: best dog you have ever met?"',
    '- Treat ambiguous extra context as about the other person, the conversation, or the situation.',
    notes.replyInstruction.length > 0
      ? '- Follow replyInstruction while preserving fact ownership.'
      : '',
    selectedTone === 'sound_more_like_me' && userStylePreference?.howTheyText
      ? '- Lean into the saved user style without sounding robotic.'
      : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeContextNotes(notes: ContextNotes): ContextNotes {
  return {
    replyInstruction: notes.replyInstruction ?? [],
    situationNotes: notes.situationNotes ?? [],
    themFacts: notes.themFacts ?? [],
    userFacts: notes.userFacts ?? [],
  };
}

function formatContextNotes(notes: ContextNotes) {
  if (
    notes.userFacts.length === 0 &&
    notes.themFacts.length === 0 &&
    notes.situationNotes.length === 0 &&
    notes.replyInstruction.length === 0
  ) {
    return '';
  }

  return [
    'Structured context notes:',
    formatNoteSection('userFacts', notes.userFacts),
    formatNoteSection('themFacts', notes.themFacts),
    formatNoteSection('situationNotes', notes.situationNotes),
    formatNoteSection('replyInstruction', notes.replyInstruction),
  ].join('\n');
}

function formatNoteSection(label: string, items: string[]) {
  if (items.length === 0) {
    return `${label}: none`;
  }

  return [`${label}:`, ...items.map((item) => `- ${item}`)].join('\n');
}

export function getMockVibeCheck(): VibeCheck {
  return {
    interestLevel: 'Medium',
    conversationEnergy: 'Dry but recoverable',
    bestTone: 'playful',
    risk: "Don't over invest",
    summary:
      "There's still interest here, but the next message should add energy without chasing.",
  };
}

export function getMockReplies(selectedTone: RepliesRequest['selectedTone']): SuggestedReply[] {
  const map: Record<RepliesRequest['selectedTone'], [string, string]> = {
    sound_more_like_me: [
      "Haha okay, I'll give you that one. What are you actually up to today?",
      "Okay, fair. I'll allow it, but only because the energy is improving.",
    ],
    playful: [
      "Damn... You're slowly becoming my favorite notification",
      "Haha okay, I'll take that. What are you actually up to today?",
    ],
    direct: [
      'I like talking to you. Want to actually make a plan this week?',
      'Okay, real answer then. When are you free?',
    ],
    casualSmallTalk: [
      "Haha fair. How's your day actually going?",
      "Okay, I'll take it. What have you been up to today?",
    ],
  };

  return map[selectedTone].map((text, index) => ({
    id: `${selectedTone}-${index + 1}`,
    text,
    tone: selectedTone,
  }));
}
