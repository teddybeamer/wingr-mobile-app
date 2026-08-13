import { getContextNotes } from './context-notes.ts';
import type {
  ContextNotes,
  GeminiVibeCheck,
  ParsedConversation,
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
      description:
        'Low, Medium, High, or Unclear based on the other person\'s romantic interest signals. High includes direct flirting, compliments, romantic invitations, two or more warm/flirty emojis anywhere in their visible messages, or playful teasing aimed at the user.',
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
        maxItems: 1,
        minItems: 1,
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

function formatSpeakerAttribution(parsedConversation?: ParsedConversation) {
  if (!parsedConversation) {
    return '';
  }

  return [
    'Speaker attribution:',
    `- latestMessageSender: ${parsedConversation.latestMessageSender}`,
    `- shouldGenerateDirectReply: ${parsedConversation.shouldGenerateDirectReply}`,
    `- speakerAttributionConfidence: ${parsedConversation.speakerAttributionConfidence.toFixed(2)}`,
    '- Message speaker values: user = screenshot owner/app user, other = the person they are talking to, unknown = uncertain/system.',
    '- Message xPosition values: right usually means user, left usually means other, center usually means system or unknown.',
    '- ME/user is always the screenshot owner.',
    '- THEM/other is always the person ME/user is talking to.',
    '- Generate replies only as user/ME to send to other/THEM.',
    '- Never generate a reply as other/THEM.',
    '- Never generate a reply to a ME/user message.',
    '- If latestMessageSender is me, treat the task as a follow-up only, not an answer.',
    'Structured messages:',
    ...parsedConversation.messages.map(
      (message) =>
        `- ${message.id}: speaker=${message.speaker}; sender=${message.sender}; xPosition=${message.xPosition}; confidence=${message.confidence.toFixed(2)}; text="${message.text}"`,
    ),
  ].join('\n');
}

export function buildVibeCheckPrompt({
  extraContext,
  parsedConversation,
  transcriptText,
}: VibeCheckRequest) {
  return [
    'Analyze this dating chat for Wingr and return concise JSON.',
    'Rules:',
    '- bestTone must be exactly one of: direct, playful, casualSmallTalk',
    '- targetLanguage is the dominant chat language, ignoring speaker labels.',
    '- Focus on social dynamics and the next-reply strategy.',
    '- conversationEnergy must explain what is happening, not just label the chat.',
    '- interestLevel must judge the other person\'s interest, not the user\'s interest.',
    '- Use High for any direct flirt, compliment, or romantic invitation; two or more warm/flirty emojis used by THEM anywhere in the visible chat (they do not need to be adjacent or in one message); or a playful tease/joke aimed at ME. A plan, questions back, or enthusiastic engagement are supporting High signals when they appear together.',
    '- Do not treat a standalone "haha" or "lol" as a joke or a High signal.',
    '- A short reply can still be High if it is clearly warm or flirty, for example "haha yesss 😍😍", "you\'re cute lol", "miss you", "when are you free?", or "come over".',
    '- Use Medium for readable cases between High and Low: polite responsiveness, light laughter, one warm/flirty emoji, some openness, or one short neutral reply.',
    '- Use Low only after two or more of THEM\'s replies are 1–3 words with no warm/flirty emoji, question, joke/tease, compliment, invitation, or reciprocal engagement.',
    '- Use Unclear only when the transcript or speaker ownership is too ambiguous to judge.',
    '- Avoid debug terms like OCR, confidence score, parsed, or Speaker A.',
    '- Only mention typos when they clearly appear in THEM\'s original message and materially affect the next reply.',
    '- If a strange word may be OCR noise, ignore it completely instead of explaining or asking about it.',
    '- vibeConfidence is low only when the transcript is short, ambiguous, or missing key context.',
    '- contextWouldImproveReplyQuality is true only when context is likely necessary.',
    '- Keep every field short and mobile-friendly.',
    'Interest examples:',
    '- THEM: "haha yesss 😍😍" -> interestLevel High',
    '- THEM: "you\'re cute lol" -> interestLevel High',
    '- THEM: "when are you free?" -> interestLevel High',
    '- THEM: "haha nice" -> interestLevel Medium',
    '- THEM: "ok" followed by "yeah" -> interestLevel Low',
    formatSpeakerAttribution(parsedConversation),
    extraContext ? `Extra context: ${extraContext}` : '',
    'Transcript:',
    transcriptText,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildGeminiVibeCheckPrompt({
  extraContext,
  parsedConversation,
  transcriptText,
}: VibeCheckRequest) {
  return [
    'You are Wingr, a socially sharp texting assistant.',
    'Read the vibe like a smart friend, not like a report.',
    'Return strict JSON only.',
    'Rules:',
    '- Speaker labels are strict: ME is the app user; THEM is the person ME is talking to.',
    '- Judge THEM\'s energy and interest toward ME, never the reverse.',
    '- If the latest message is ME, do not pretend THEM just said it.',
    '- Do not use profile names, account names, device owner names, or any name outside the actual chat transcript.',
    '- Keep it short, casual, specific, and actually useful.',
    '- Match the natural language of the chat for oneLiner, theirEnergy, yourMove, and avoid.',
    '- Do not mix languages.',
    '- targetLanguage is the dominant chat language as an English language name.',
    '- recommendedTone must be one of: Playful, Flirty, Direct, Casual Small Talk, Small talk, Make it right.',
    '- confidence must be a number from 0 to 1.',
    '- Avoid robotic/report words: moderate, neutral, indicates, suggests, engagement, rapport, dynamic, pursue, reciprocate, initiate.',
    '- Only comment on typos if the typo is clearly in THEM\'s original message and affects what ME should reply.',
    '- If a strange word may be OCR noise or model noise, ignore it. Do not mention random unclear tokens.',
    '- Prefer natural phrases like: a bit dry, still interested, low effort, playful, curious, don\'t overdo it, make it easy to answer, keep it light.',
    '- Keep oneLiner, theirEnergy, yourMove, and avoid short enough for a mobile card.',
    formatSpeakerAttribution(parsedConversation),
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
  parsedConversation,
  selectedTone,
  transcriptText,
  userStylePreference,
  vibeCheck,
}: RepliesRequest) {
  return buildReplyBatchPrompt(
    {
      contextNotes,
      extraContext,
      parsedConversation,
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
    parsedConversation,
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
  const toneInstructions = selectedTones.map((tone) => `- ${tone}: generate exactly 1 reply`).join('\n');

  return [
    'Generate a batch of reply suggestions for the user in this dating chat.',
    languageInstruction,
    `Requested tones: ${selectedTones.join(', ')}`,
    userStylePreference?.howTheyText ? `Saved user style preference: ${userStylePreference.howTheyText}` : '',
    `Vibe check summary: ${vibeCheck.summary}`,
    `Interest level: ${vibeCheck.interestLevel}`,
    `Conversation energy: ${vibeCheck.conversationEnergy}`,
    `Risk to avoid: ${vibeCheck.risk}`,
    formatSpeakerAttribution(parsedConversation),
    formatContextNotes(notes),
    'Rules:',
    '- Return one replyBatch object with the requested tones as keys.',
    `- Every reply must be written in ${targetLanguage}. This is a hard requirement for every tone.`,
    '- Tone names, saved style preferences, vibe check text, and system labels may be English; do not use those as the reply language.',
    '- Do not translate the conversation into English unless the transcript itself is primarily English.',
    '- Keep every reply realistic to send.',
    '- When multiple tones are requested, make their replies meaningfully distinct.',
    '- Match THEM\'s conversational effort rather than simply matching message length.',
    '- Replies should generally feel proportional to THEM\'s effort, energy, and level of investment.',
    '- Default to a roughly similar message length, pacing, and energy as THEM\'s latest message.',
    '- Slightly shorter is usually better than significantly longer, unless a longer reply feels more natural in context.',
    '- Mirror humor, emoji use, casualness, and texting style lightly without copying.',
    '- Every reply should naturally move the conversation forward by giving THEM something easy or enjoyable to respond to.',
    '- Do not force a question into every reply; a playful observation, tease, callback, assumption, or open-ended statement can also create momentum.',
    '- Avoid dead-end acknowledgements unless ending or pausing the conversation is clearly appropriate.',
    '- Avoid noticeably over-investing relative to THEM\'s current effort and interest.',
    '- Never include random OCR-looking tokens, unexplained all-caps strings, or unclear mixed-symbol words in replies.',
    '- If an unclear word appears in the transcript, reply naturally to the visible context instead of asking what that unclear word means.',
    '- Do not mention typos unless the typo is clearly in THEM\'s original message and the reply genuinely needs to address it.',
    '- Do not mention ME\'s name unless that name appears naturally in the actual chat messages.',
    '- Speaker labels are strict: ME is the app user; THEM is the other person.',
    '- Every reply must be something ME can send to THEM.',
    '- Generate replies from the screenshot owner/user perspective only.',
    '- Only respond to the latest message whose speaker is other/THEM.',
    '- Never reply as THEM or as the other person.',
    '- Never write a reply that answers a ME message as if THEM had sent it.',
    '- If latestMessageSender is me or shouldGenerateDirectReply is false, write natural follow-ups only. Do not make it sound like THEM just asked something.',
    '- Do not use profile names, account names, device owner names, or inferred real names.',
    '- If speaker detection is uncertain, avoid names and avoid assumptions.',
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
    `- The previous attempt did not follow the language requirement. Rewrite exactly one reply in ${targetLanguage} for each requested tone.`,
    '- Do not write any English words unless they are names, app names, game names, or quoted terms already present in the transcript.',
    '- Do not carry over random OCR-looking tokens or unclear mixed-symbol words from the previous replies.',
    '- Do not mention ME\'s name unless that name appears naturally in the actual chat messages.',
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
    '- Determine the dominant natural language from the actual chat messages in Transcript only. Ignore ME/THEM/UNKNOWN labels, UI text, profile names, timestamps, and OCR noise.',
    '- Weight the most recent 4–6 real messages more heavily than very old messages in the screenshot.',
    '- If one language has a clear majority across the conversation, use that language for every reply.',
    '- Do not switch reply language because of one isolated message or phrase in another language.',
    '- Only use the latest real message from THEM as a tie-breaker when there is no clear dominant language.',
    '- If the conversation clearly transitions to a new language and the recent conversation consistently uses it, use the newer language.',
    `- Write one suggested reply in ${targetLanguage}, using the same script and a natural casual texting register.`,
    '- Examples: Danish transcript -> Danish replies; Spanish transcript -> Spanish replies; French transcript -> French replies.',
    '- Keep names, app names, games, slang, and quoted words as they naturally appear in the conversation.',
    `Transcript language source text:\n${stripSpeakerLabels(transcriptText)}`,
  ].join('\n');
}

function stripSpeakerLabels(transcriptText: string) {
  return transcriptText
    .split('\n')
    .map((line) => line.replace(/^\s*(ME|THEM|UNKNOWN|You|Them|Unknown)\s*:\s*/i, '').trim())
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
  const map: Record<RepliesRequest['selectedTone'], string> = {
    playful: "Damn... You're slowly becoming my favorite notification",
    direct: 'I like talking to you. Want to actually make a plan this week?',
    casualSmallTalk: "Haha fair. How's your day actually going?",
  };

  return [{
    id: `${selectedTone}-1`,
    text: map[selectedTone],
    tone: selectedTone,
  }];
}

export function getMockReplyBatch(selectedTones: ReplyTone[]): ReplyBatch {
  return Object.fromEntries(selectedTones.map((tone) => [tone, getMockReplies(tone)]));
}
