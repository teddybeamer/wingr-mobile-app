import { getContextNotes } from './context-notes.ts';
import type {
  ContextNotes,
  GeminiVibeCheck,
  ReplyBatch,
  RepliesRequest,
  ReplyTone,
  SuggestedReply,
  VibeCheck,
  VibeCheckRequest,
} from './types.ts';

export const vibeCheckSchema = {
  additionalProperties: false,
  properties: {
    bestTone: {
      enum: ['direct', 'playful', 'casualSmallTalk'],
      type: 'string',
    },
    conversationEnergy: {
      description:
        'A short, human-readable explanation of what seems to be happening in the chat. Avoid labels, parsing terms, confidence scores, OCR language, or speaker-debug language.',
      type: 'string',
    },
    contextWouldImproveReplyQuality: {
      description:
        'True only when the transcript is clearly too short, ambiguous, or missing necessary context for a good reply.',
      type: 'boolean',
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
    targetLanguage: {
      description:
        'The dominant natural language of the actual chat messages, written as an English language name such as Danish, Spanish, French, German, or English.',
      type: 'string',
    },
    vibeConfidence: {
      description:
        'How confident the model is that it understands the social situation from the transcript.',
      enum: ['low', 'medium', 'high'],
      type: 'string',
    },
  },
  required: [
    'interestLevel',
    'conversationEnergy',
    'bestTone',
    'risk',
    'summary',
    'targetLanguage',
    'vibeConfidence',
    'contextWouldImproveReplyQuality',
  ],
  type: 'object',
} as const;

export const geminiVibeCheckSchema = {
  additionalProperties: false,
  properties: {
    avoid: {
      description:
        'A short, casual warning about what the user should not do next.',
      type: 'string',
    },
    confidence: {
      description: 'A number from 0 to 1 showing how confident the read is.',
      maximum: 1,
      minimum: 0,
      type: 'number',
    },
    oneLiner: {
      description:
        'One casual, useful read of the vibe. It should sound like a smart friend, not a report.',
      type: 'string',
    },
    recommendedTone: {
      enum: ['Playful', 'Flirty', 'Direct', 'Casual Small Talk', 'Small talk', 'Make it right'],
      type: 'string',
    },
    targetLanguage: {
      description:
        'The dominant natural language of the actual chat messages, written as an English language name such as Danish, Spanish, French, German, or English.',
      type: 'string',
    },
    theirEnergy: {
      description:
        'One short phrase or sentence about how the other person is showing up.',
      type: 'string',
    },
    yourMove: {
      description:
        'One short next move for the user.',
      type: 'string',
    },
  },
  required: ['oneLiner', 'theirEnergy', 'yourMove', 'avoid', 'recommendedTone', 'confidence', 'targetLanguage'],
  type: 'object',
} as const;

const replyItemSchema = {
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    tone: {
      enum: ['direct', 'playful', 'casualSmallTalk'],
      type: 'string',
    },
  },
  required: ['id', 'tone', 'text'],
  type: 'object',
} as const;

export function createReplyBatchSchema(selectedTones: ReplyTone[]) {
  const properties = Object.fromEntries(
    selectedTones.map((tone) => [
      tone,
      {
        items: replyItemSchema,
        maxItems: 2,
        minItems: 2,
        type: 'array',
      },
    ]),
  );

  return {
    additionalProperties: false,
    properties: {
      replyBatch: {
        additionalProperties: false,
        properties,
        required: selectedTones,
        type: 'object',
      },
    },
    required: ['replyBatch'],
    type: 'object',
  } as const;
}

export function buildVibeCheckPrompt({ extraContext, transcriptText }: VibeCheckRequest) {
  return [
    'Analyze this dating chat for Wingr and return concise JSON.',
    'Rules:',
    '- bestTone must be exactly one of: direct, playful, casualSmallTalk',
    '- targetLanguage is the dominant chat language, ignoring speaker labels.',
    '- Focus on social dynamics and the next-reply strategy.',
    '- conversationEnergy must explain what is happening, not just label the chat.',
    '- Avoid debug terms like OCR, confidence score, parsed, or Speaker A.',
    '- vibeConfidence is low only when the transcript is short, ambiguous, or missing key context.',
    '- contextWouldImproveReplyQuality is true only when context is likely necessary.',
    '- Keep every field short and mobile-friendly.',
    extraContext ? `Extra context: ${extraContext}` : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildGeminiVibeCheckPrompt({ extraContext, transcriptText }: VibeCheckRequest) {
  return [
    'You are Wingr, a socially sharp texting assistant.',
    'Read the vibe like a smart friend, not like a report.',
    'Return strict JSON only.',
    'Rules:',
    '- Keep it short, casual, specific, and actually useful.',
    '- Match the natural language of the chat for oneLiner, theirEnergy, yourMove, and avoid.',
    '- Do not mix languages.',
    '- targetLanguage is the dominant chat language as an English language name.',
    '- recommendedTone must be one of: Playful, Flirty, Direct, Casual Small Talk, Small talk, Make it right.',
    '- confidence must be a number from 0 to 1.',
    '- Avoid robotic/report words: moderate, neutral, indicates, suggests, engagement, rapport, dynamic, pursue, reciprocate, initiate.',
    '- Prefer natural phrases like: a bit dry, still interested, low effort, playful, curious, don\'t overdo it, make it easy to answer, keep it light.',
    '- Keep oneLiner, theirEnergy, yourMove, and avoid short enough for a mobile card.',
    'Bad example:',
    '{"oneLiner":"Interest is moderate.","theirEnergy":"Energy is neutral.","yourMove":"Ask a playful follow-up question.","avoid":"Avoid overpursuing.","recommendedTone":"Playful","confidence":0.7,"targetLanguage":"English"}',
    'Good example:',
    '{"oneLiner":"They are not cold, but they are making you do some of the work.","theirEnergy":"Warm, but a little low-effort.","yourMove":"Keep it light and give them something easy to answer.","avoid":"Do not send a paragraph here.","recommendedTone":"Playful","confidence":0.82,"targetLanguage":"English"}',
    extraContext ? `Extra context: ${extraContext}` : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

export function getMockGeminiVibeCheck(): GeminiVibeCheck {
  return {
    avoid: "Don't send a paragraph here.",
    confidence: 0.72,
    oneLiner: 'They are not cold, but they are making you do some of the work.',
    recommendedTone: 'Playful',
    targetLanguage: 'English',
    theirEnergy: 'Warm, but a little low-effort.',
    yourMove: 'Keep it light and make it easy to answer.',
  };
}

export function buildRepliesPrompt({
  contextNotes,
  extraContext,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: RepliesRequest) {
  return buildReplyBatchPrompt(
    {
      contextNotes,
      extraContext,
      selectedTone,
      transcriptText,
      userStylePreference,
      vibeCheck,
    },
    [selectedTone],
  );
}

export function buildReplyBatchPrompt(
  {
    contextNotes,
    extraContext,
    selectedTone,
    transcriptText,
    userStylePreference,
    vibeCheck,
  }: RepliesRequest,
  selectedTones: ReplyTone[],
) {
  const notes = normalizeContextNotes(contextNotes ?? getContextNotes(extraContext));
  const targetLanguage = normalizeTargetLanguage(vibeCheck.targetLanguage);
  const languageInstruction = getReplyLanguageInstruction(transcriptText, targetLanguage);
  const toneInstructions = selectedTones.map((tone) => `- ${tone}: generate exactly 2 distinct replies`).join('\n');

  return [
    'Generate a batch of reply suggestions for the user in this dating chat.',
    languageInstruction,
    `Requested tones: ${selectedTones.join(', ')}`,
    userStylePreference?.howTheyText ? `Saved user style preference: ${userStylePreference.howTheyText}` : '',
    `Vibe check summary: ${vibeCheck.summary}`,
    `Interest level: ${vibeCheck.interestLevel}`,
    `Conversation energy: ${vibeCheck.conversationEnergy}`,
    `Risk to avoid: ${vibeCheck.risk}`,
    formatContextNotes(notes),
    'Rules:',
    '- Return one replyBatch object with the requested tones as keys.',
    `- Every reply must be written in ${targetLanguage}. This is a hard requirement for every tone.`,
    '- Tone names, saved style preferences, vibe check text, and system labels may be English; do not use those as the reply language.',
    '- Do not translate the conversation into English unless the transcript itself is primarily English.',
    '- Keep each reply concise, realistic to send, and distinct from the others in the same tone.',
    '- Avoid over-investing.',
    '- The tone field on each reply must match its tone bucket exactly.',
    toneInstructions,
    '- Context ownership is strict: userFacts are about the user; themFacts are about the other person.',
    '- Do not claim the user likes, feels, has done, or has experienced anything unless it appears in userFacts or the transcript.',
    '- If a themFact is useful, reference it as something relevant to the other person, not as the user owning that fact.',
    '- Use themFacts as light hooks for a question or playful observation. Do not turn them into a made-up personal anecdote.',
    '- Do not invent pets, roommates, weekend plans, routines, hobbies, favorite places, or matching interests for the user.',
    '- If themFacts mention dogs or pets, do not write "my dog", "my pup", "my furry roommate", or "I love dogs too" unless userFacts or the user transcript explicitly says that.',
    '- A safe dog mention is a casual question like "Important question: best dog you have ever met?"',
    '- Treat ambiguous extra context as about the other person, the conversation, or the situation.',
    notes.replyInstruction.length > 0 ? '- Follow replyInstruction while preserving fact ownership.' : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildReplyLanguageRepairPrompt(
  request: RepliesRequest,
  previousReplies: SuggestedReply[],
  selectedTones: ReplyTone[],
) {
  const targetLanguage = normalizeTargetLanguage(request.vibeCheck.targetLanguage);

  return [
    buildReplyBatchPrompt(request, selectedTones),
    '',
    'Language repair:',
    `- The previous attempt did not follow the language requirement. Rewrite exactly two replies in ${targetLanguage}.`,
    '- Do not write any English words unless they are names, app names, game names, or quoted terms already present in the transcript.',
    '- Preserve the selected tone and all ownership rules.',
    'Previous invalid replies:',
    previousReplies.map((reply) => `- ${reply.text}`).join('\n'),
  ].join('\n');
}

function normalizeTargetLanguage(targetLanguage?: string) {
  const normalized = targetLanguage?.trim();

  return normalized || 'the same language as the transcript';
}

function getReplyLanguageInstruction(transcriptText: string, targetLanguage: string) {
  return [
    'Reply language:',
    `- Target reply language: ${targetLanguage}.`,
    '- Infer the dominant natural language from the actual chat messages in Transcript, ignoring speaker labels like You/Them/Unknown.',
    `- Write both suggested replies in ${targetLanguage}, using the same script and a natural casual texting register.`,
    '- If the conversation is mixed-language, use the language of the latest real message from Them. If that is unclear, use the language of the latest real message from You.',
    '- Examples: Danish transcript -> Danish replies; Spanish transcript -> Spanish replies; French transcript -> French replies.',
    '- Keep names, app names, games, slang, and quoted words as they naturally appear in the conversation.',
    `Transcript language source text:\n${stripSpeakerLabels(transcriptText)}`,
  ].join('\n');
}

function stripSpeakerLabels(transcriptText: string) {
  return transcriptText
    .split('\n')
    .map((line) => line.replace(/^\s*(You|Them|Unknown)\s*:\s*/i, '').trim())
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
    conversationEnergy: "They're keeping it short, but there's still room to play.",
    bestTone: 'playful',
    risk: "Don't over invest",
    summary:
      "There's still interest here, but the next message should add energy without chasing.",
    targetLanguage: 'English',
    vibeConfidence: 'medium',
    contextWouldImproveReplyQuality: false,
  };
}

export function getMockReplies(selectedTone: RepliesRequest['selectedTone']): SuggestedReply[] {
  const map: Record<RepliesRequest['selectedTone'], [string, string]> = {
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

export function getMockReplyBatch(selectedTones: ReplyTone[]): ReplyBatch {
  return Object.fromEntries(selectedTones.map((tone) => [tone, getMockReplies(tone)]));
}
