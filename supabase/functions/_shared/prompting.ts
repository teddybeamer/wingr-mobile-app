import { getContextNotes } from './context-notes.ts';
import { getConversationTurnState } from './conversation-turn-state.ts';
import { getReplyAnswerability } from './reply-answerability.ts';
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
    interestLevel: {
      description:
        'The other person\'s romantic interest in ME: Low, Medium, High, or Unclear. Assess behavioral evidence and conversational intent across the sequence, not writing style.',
      enum: ['Low', 'Medium', 'High', 'Unclear'],
      type: 'string',
    },
    yourMove: {
      description:
        'One short next move for the user.',
      type: 'string',
    },
  },
  required: [
    'oneLiner',
    'theirEnergy',
    'yourMove',
    'avoid',
    'recommendedTone',
    'confidence',
    'targetLanguage',
    'interestLevel',
  ],
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

function formatAuthoritativeTurnState(parsedConversation?: ParsedConversation) {
  const turnState = getConversationTurnState(parsedConversation);

  if (!turnState) {
    return '';
  }

  return [
    'Authoritative conversation state (derived from the structured ME/THEM sequence):',
    `- latestMessageSender: ${turnState.latestMessageSender}`,
    `- THEM messages after the most recent ME message: ${turnState.themMessagesAfterLatestMe}`,
    `- THEM has responded after ME: ${turnState.themHasRespondedAfterMe ? 'yes' : 'no'}`,
    '- This state and the structured messages are authoritative. Do not invent a different reply order, waiting state, or fact owner.',
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
    '- Derive who has replied, who is waiting, and whose turn it is only from the authoritative conversation state and structured ME/THEM messages below.',
    '- If the authoritative state says THEM has responded after ME, never claim or imply that THEM has not responded, that ME is still waiting for a reply, or that ME sent unanswered messages.',
    '- Preserve every established fact with its original speaker. Do not describe a ME action, plan, place, or experience as something THEM did, or the reverse.',
    '- Do not use profile names, account names, device owner names, or any name outside the actual chat transcript.',
    '- Keep it short, casual, specific, and actually useful.',
    '- Match the natural language of the chat for oneLiner, theirEnergy, yourMove, and avoid.',
    '- Do not mix languages.',
    '- targetLanguage is the dominant chat language as an English language name.',
    '- recommendedTone must be one of: Playful, Flirty, Direct, Casual Small Talk, Small talk, Make it right.',
    '- confidence must be a number from 0 to 1.',
    '- Decide interestLevel internally from the full conversation before writing the other fields. Return only the final level; do not expose reasoning.',
    '- Prioritize behavioral intent and actions over surface style. A direct invitation, clear attraction, or concrete effort to move things forward outweighs emoji count, message length, punctuation, or speed of reply.',
    '- Read the chat as a sequence: assess whether interest is reciprocated and increasing, decreasing, stable, or escalating. Weight recent messages more heavily while preserving decisive earlier events such as a direct invitation, rejection, or compliment.',
    '- High means strong evidence of attraction or romantic progression: a direct compliment, explicit attraction, suggesting or agreeing to meet, asking ME out, initiating/strongly reciprocating flirting, or actively creating an opportunity to deepen the connection. A clear invitation or compliment normally means High unless meaningful later evidence contradicts it.',
    '- Medium means genuine but romantically ambiguous interest: warm replies, questions, friendly curiosity, light flirting, or some investment without clear attraction or progression toward meeting. Use Medium rather than Low for a short conversation with insufficient romantic evidence.',
    '- Low means sustained low investment or meaningful negative evidence: repeatedly dismissive/minimal replies, no reciprocation, avoiding attempts to progress, shutting down flirting, declining plans without an alternative, or clear distancing. A single short or dry message is not Low by itself.',
    '- Do not infer High from emojis, long messages, fast replies, or questions alone. Emojis can strengthen a semantic reading but cannot create romantic intent by themselves. Do not penalize plain or dry texting when THEM is still proposing plans or showing attraction.',
    '- Resolve contradictions across fields: if oneLiner, theirEnergy, or yourMove identifies a direct invitation, clear attraction, or active romantic escalation, interestLevel must be High unless you state meaningful contradictory evidence.',
    'Interest calibration examples:',
    '- THEM: "Super cute by the way 😘" then "Want to meet?" -> High.',
    '- THEM sends warm, detailed replies and questions but no flirt, attraction, or plan -> Medium.',
    '- THEM sends many emojis but does not reciprocate or invest -> not automatically High.',
    '- THEM writes plainly but says "Want to grab coffee Saturday?" -> High.',
    '- THEM repeatedly starts playful/flirty conversations -> High.',
    '- THEM is friendly but ME is carrying the conversation -> Low or Medium according to the actual amount of reciprocation; do not call it High.',
    '- THEM declines a date and offers no alternative while engagement drops -> Low.',
    '- THEM declines a date but immediately offers another day -> High or strong Medium according to the wording and other evidence.',
    '- A short chat with no clear romantic evidence -> Medium, not automatically Low.',
    '- For mixed signals, let a clear recent invitation, rejection, or change in investment outweigh older small talk.',
    '- Avoid robotic/report words: moderate, neutral, indicates, suggests, engagement, rapport, dynamic, pursue, reciprocate, initiate.',
    '- Only comment on typos if the typo is clearly in THEM\'s original message and affects what ME should reply.',
    '- If a strange word may be OCR noise or model noise, ignore it. Do not mention random unclear tokens.',
    '- Prefer natural phrases like: a bit dry, still interested, low effort, playful, curious, don\'t overdo it, make it easy to answer, keep it light.',
    '- Keep oneLiner, theirEnergy, yourMove, and avoid short enough for a mobile card.',
    formatSpeakerAttribution(parsedConversation),
    formatAuthoritativeTurnState(parsedConversation),
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
    interestLevel: 'Medium',
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
  const answerability = getReplyAnswerability({
    contextNotes,
    extraContext,
    parsedConversation,
    selectedTone,
    transcriptText,
    userStylePreference,
    vibeCheck,
  });
  const placeholderInstruction = answerability.placeholderAllowed && answerability.placeholder
    ? [
      'Answerability state:',
      '- THEM asks for a concrete ME fact that is not established by the transcript or userFacts.',
      `- You may answer naturally with exactly one editable slot: ${answerability.placeholder}`,
      '- Prefer that slot over guessing a concrete answer or avoiding the question with a generic fallback.',
      '- Keep the slot bracketed inside an otherwise finished text message. Do not explain the slot to THEM.',
      '- Do not use any other bracketed placeholder.',
    ].join('\n')
    : [
      'Answerability state:',
      '- Do not use bracketed placeholders for this reply; no unknown-ME-fact slot is needed.',
    ].join('\n');

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
    placeholderInstruction,
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
    'Grounding and relevance (apply before choosing the tone):',
    '- First identify THEM\'s latest direct question, invitation/proposal, strongest concrete hook, and emotional or flirty intent. Address the strongest/latest actionable hook when one is clear; with limited context, a harmless conversational opening is allowed.',
    '- Separate facts established about ME, facts established about THEM, and facts that are unknown. The transcript and userFacts are the only evidence for a concrete claim about ME.',
    '- Preserve fact ownership: ME-established facts are not evidence that the same concrete fact is true of THEM. Do not state an unsupported concrete fact about THEM as true, but natural questions, playful assumptions, teasing, and clearly framed social interpretations are allowed.',
    '- Invent wording, not ME\'s reality. Never introduce an unsupported concrete personal fact about ME, including plans, hobbies, favorites, preferences, work/studies, friends/family, locations, experiences, possessions, opinions, or activities.',
    '- Do not strengthen evidence: ME saying they played a game supports saying they have played it, but does not establish it is their favorite game or hobby.',
    '- When THEM asks for information that is unknown, answer without committing to an invented fact: stay non-specific, playfully deflect, turn it back, or invite a suggestion when natural.',
    '- Unknown is not a negative fact. If ME\'s favorite, plan, preference, or opinion is not established, do not claim that ME does not have one or is not interested; simply avoid committing to an answer.',
    '- A grounded reply can still be creative: tease THEIR intent, lightly answer using an established fact, make a playful interpretation of THEIR visible message, or create an opening. Do not become literal or generic just because a fact is unknown.',
    '- Light conversational inferences are allowed when phrased as teasing, uncertainty, or a question, rather than as a concrete fact about ME or THEM.',
    '- A harmless new conversational direction is allowed when it does not assert a specific personal fact, event, relationship, location, plan, preference, or detail that is not established in the conversation.',
    '- When generating more than one reply, use meaningfully different conversational moves instead of rephrasing the same deflection or question.',
    '- Do not use the emergency fallback wording "Got something in mind?" as a normal generated reply.',
    '- With limited context, a short neutral follow-up such as "Okay, now I need the story behind that" or "Haha wait, elaborate" is allowed when it naturally responds to THEM\'s latest message. Avoid an orphan reference only when there is no visible conversational cue at all.',
    '- Tone changes how a grounded strategy is expressed—playfulness, warmth, directness, flirtiness, length—not what facts ME can claim or which hook the reply addresses.',
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

export function buildReplyGroundingRepairPrompt(
  request: RepliesRequest,
  previousReplies: SuggestedReply[],
  selectedTones: ReplyTone[],
  rejectionCodes: string[] = [],
) {
  const rejectionReason = rejectionCodes.length > 0
    ? rejectionCodes.join(', ')
    : 'ownership_or_grounding';
  const answerability = getReplyAnswerability(request);
  const placeholderRepairInstruction = answerability.placeholderAllowed && answerability.placeholder
    ? `- This question requires user knowledge. Use the allowed editable slot ${answerability.placeholder} instead of attempting another concrete value.`
    : '';

  return [
    buildReplyBatchPrompt(request, selectedTones),
    '',
    'Grounding and relevance repair:',
    `- Privacy-safe validator reason code(s): ${rejectionReason}.`,
    '- Do not treat a fact established only about ME as proof that it is true of THEM. Avoid unsupported concrete claims about THEM while keeping natural questions, playful assumptions, teasing, and clearly framed social interpretations available.',
    '- The previous reply was rejected because it may invent a concrete fact, reverse fact ownership, use an unsupported name, contain OCR noise, or reply from the wrong speaker perspective.',
    '- Re-read the transcript before rewriting. Preserve only facts established about ME; do not turn an activity into a favorite, hobby, plan, preference, or other stronger claim.',
    '- If THEM asks something ME has not answered in the transcript or userFacts, use a natural non-committal answer, playful deflection, turnaround, or invitation rather than inventing details.',
    placeholderRepairInstruction,
    '- Unknown information is not evidence of its opposite: never turn an unknown favorite, plan, preference, or opinion into a negative personal claim.',
    '- Choose a fresh conversational move for every rewrite: tease THEIR intent, lightly use an established fact, make a playful interpretation, use a neutral follow-up, playfully deflect, turn the question back, or create an opening. Do not reuse or paraphrase a rejected fallback.',
    '- Limited context is not itself a rejection reason. A neutral follow-up or clearly playful interpretation is valid when it does not invent a concrete personal fact. Rewrite exactly one natural reply for each requested tone. When more than one tone is requested, the replies must use meaningfully distinct moves. Keep the requested tone, language, speaker ownership, and direct-reply rules.',
    'Previous rejected replies:',
    previousReplies.map((reply) => `- ${reply.text}`).join('\n'),
  ].join('\n');
}

export function buildReplyEmergencyPrompt(
  request: RepliesRequest,
  selectedTones: ReplyTone[],
  rejectionCodes: string[] = [],
) {
  const rejectionReason = rejectionCodes.length > 0
    ? rejectionCodes.join(', ')
    : 'previous_generation_failed';
  const answerability = getReplyAnswerability(request);
  const placeholderEmergencyInstruction = answerability.placeholderAllowed && answerability.placeholder
    ? `- This question requires user knowledge. Use the allowed editable slot ${answerability.placeholder}; do not guess a concrete answer.`
    : '';

  return [
    buildReplyBatchPrompt(request, selectedTones),
    '',
    'Emergency reply generation:',
    `- Earlier attempts did not produce a valid reply. Privacy-safe reason code(s): ${rejectionReason}.`,
    '- Generate exactly one short, natural reply for each requested tone using the original transcript and context above.',
    '- Respond to the latest message from THEM: answer a direct question naturally when possible; otherwise continue the actual conversational thread.',
    '- Preserve the requested tone where it is safe. For Playful, use warm light teasing only when the transcript supports it.',
    '- Use only clearly established context. Do not invent concrete facts, plans, locations, relationships, possessions, preferences, work, hobbies, events, experiences, or names.',
    placeholderEmergencyInstruction,
    '- Keep the reply text-message-like. Never use the terminal fallback wording.',
    '- The same strict ownership, language, speaker perspective, and schema requirements still apply.',
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
