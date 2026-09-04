import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGeminiVibeCheckPrompt,
  buildVibeCheckPrompt,
  buildReplyEmergencyPrompt,
  buildReplyGroundingRepairPrompt,
  buildRepliesPrompt,
  createReplyBatchSchema,
  geminiVibeCheckSchema,
  getMockReplies,
} from './prompting.ts';
import type { RepliesRequest, VibeCheckRequest } from './types.ts';

const request: RepliesRequest = {
  selectedTone: 'playful',
  transcriptText: 'THEM: Want to get coffee this week?',
  vibeCheck: {
    bestTone: 'playful',
    contextWouldImproveReplyQuality: false,
    conversationEnergy: 'Warm and open to making plans.',
    interestLevel: 'High',
    risk: 'Do not overthink it.',
    summary: 'Keep it easy and make a plan.',
    targetLanguage: 'English',
    vibeConfidence: 'high',
  },
};

test('reply batch schema requires exactly one reply for every requested tone', () => {
  const schema = createReplyBatchSchema(['playful', 'direct']);
  const toneSchemas = schema.properties.replyBatch.properties as Record<
    string,
    { maxItems: number; minItems: number }
  >;

  assert.deepEqual(toneSchemas.playful, {
    items: {
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
    },
    maxItems: 1,
    minItems: 1,
    type: 'array',
  });
  assert.equal(toneSchemas.direct.minItems, 1);
  assert.equal(toneSchemas.direct.maxItems, 1);
});

test('reply prompts and mocks use one reply per selected tone', () => {
  const replyPrompt = buildRepliesPrompt(request);

  assert.match(replyPrompt, /playful: generate exactly 1 reply/);
  assert.match(replyPrompt, /Write one suggested reply in English/);
  assert.doesNotMatch(replyPrompt, /exactly 2|both suggested replies/);
  assert.equal(getMockReplies('playful').length, 1);
});

test('reply grounding applies to every selectable tone and prioritizes actionable hooks', () => {
  const groundingRequest: RepliesRequest = {
    ...request,
    transcriptText: [
      'ME: I played Dota 2 last night.',
      'THEM: What is your favorite game, and what are you doing this weekend?',
    ].join('\n'),
  };

  const prompts = ['playful', 'direct', 'casualSmallTalk'].map((selectedTone) =>
    buildRepliesPrompt({ ...groundingRequest, selectedTone: selectedTone as RepliesRequest['selectedTone'] }),
  );

  prompts.forEach((prompt) => {
    assert.match(prompt, /latest direct question, invitation\/proposal, strongest concrete hook/i);
    assert.match(prompt, /Invent wording, not ME's reality/i);
    assert.match(prompt, /plans, hobbies, favorites, preferences/i);
    assert.match(prompt, /played a game.*does not establish it is their favorite/i);
    assert.match(prompt, /unknown.*stay non-specific, playfully deflect, turn it back/i);
    assert.match(prompt, /Unknown is not a negative fact/i);
    assert.match(prompt, /Light conversational inferences are allowed/i);
    assert.match(prompt, /With limited context, a short neutral follow-up/i);
    assert.match(prompt, /meaningfully different conversational moves/i);
    assert.match(prompt, /Do not use the emergency fallback wording/i);
    assert.match(prompt, /With limited context, a short neutral follow-up/i);
    assert.match(prompt, /Tone changes how a grounded strategy is expressed/i);
  });
});

test('emergency reply prompt keeps generation contextual without local intent branches', () => {
  const prompt = buildReplyEmergencyPrompt(request, ['playful'], ['ownership_or_grounding']);

  assert.match(prompt, /Emergency reply generation/);
  assert.match(prompt, /Respond to the latest message from THEM/);
  assert.match(prompt, /answer a direct question naturally/i);
  assert.match(prompt, /original transcript and context/i);
  assert.match(prompt, /ownership_or_grounding/);
});

test('prompts preserve structured speaker ownership and turn state', () => {
  const parsedConversation = {
    latestMessageSender: 'them' as const,
    messages: [
      {
        boundingBox: { height: 20, width: 300, x: 10, y: 10 },
        confidence: 0.98,
        id: 'me-1',
        sender: 'me' as const,
        speaker: 'user' as const,
        text: 'Ja er en tur i Norge med mine brødre. Vi er på fjellet. Var meningen vi skulle lave ishytte, men der er sgu storm heroppe 😛 Hvordan går din ferie?',
        xPosition: 'right' as const,
      },
      {
        boundingBox: { height: 20, width: 300, x: 10, y: 40 },
        confidence: 0.98,
        id: 'them-1',
        sender: 'them' as const,
        speaker: 'other' as const,
        text: 'Det går godt. Hygger mig hjemme og min tidligere roommate er på besøg fra Hamburg så det er virkelig chill',
        xPosition: 'left' as const,
      },
      {
        boundingBox: { height: 20, width: 300, x: 10, y: 70 },
        confidence: 0.98,
        id: 'them-2',
        sender: 'them' as const,
        speaker: 'other' as const,
        text: 'Håber du overlever stormen. Hørt at det skulle være virkelig slemt',
        xPosition: 'left' as const,
      },
    ],
    shouldGenerateDirectReply: true,
    speakerAttributionConfidence: 0.98,
  };
  const transcriptText = [
    'ME: Ja er en tur i Norge med mine brødre. Vi er på fjellet. Var meningen vi skulle lave ishytte, men der er sgu storm heroppe 😛 Hvordan går din ferie?',
    'THEM: Det går godt. Hygger mig hjemme og min tidligere roommate er på besøg fra Hamburg så det er virkelig chill',
    'THEM: Håber du overlever stormen. Hørt at det skulle være virkelig slemt',
  ].join('\n');
  const replyPrompt = buildRepliesPrompt({ ...request, parsedConversation, transcriptText });
  const vibePrompt = buildGeminiVibeCheckPrompt({ parsedConversation, transcriptText });

  assert.match(replyPrompt, /Preserve fact ownership: ME-established facts are not evidence/i);
  assert.match(replyPrompt, /Do not state an unsupported concrete fact about THEM as true/i);
  assert.match(vibePrompt, /latestMessageSender: them/i);
  assert.match(vibePrompt, /THEM messages after the most recent ME message: 2/i);
  assert.match(vibePrompt, /THEM has responded after ME: yes/i);
  assert.match(vibePrompt, /never claim or imply that THEM has not responded/i);
  assert.match(vibePrompt, /Preserve every established fact with its original speaker/i);
});

test('grounding repair rewrites unsupported or irrelevant replies from the transcript', () => {
  const repairPrompt = buildReplyGroundingRepairPrompt(
    {
      ...request,
      transcriptText: 'THEM: What are you doing this weekend?',
    },
    [
      {
        id: 'direct-1',
        text: 'I am planning to catch up on reading and go for a hike.',
        tone: 'direct',
      },
    ],
    ['direct'],
  );

  assert.match(repairPrompt, /Grounding and relevance repair/i);
  assert.match(repairPrompt, /validator reason code\(s\): ownership_or_grounding/i);
  assert.match(repairPrompt, /may invent a concrete fact, reverse fact ownership/i);
  assert.match(repairPrompt, /activity into a favorite, hobby, plan, preference/i);
  assert.match(repairPrompt, /natural non-committal answer, playful deflection, turnaround/i);
  assert.match(repairPrompt, /Limited context is not itself a rejection reason/i);
  assert.match(repairPrompt, /Unknown information is not evidence of its opposite/i);
  assert.match(repairPrompt, /Choose a fresh conversational move/i);
  assert.match(repairPrompt, /planning to catch up on reading/i);
});

test('grounding repair keeps social inference available while protecting concrete facts', () => {
  const repairPrompt = buildReplyGroundingRepairPrompt(request, [], ['direct']);

  assert.match(repairPrompt, /not evidence that the same concrete fact is true of THEM/i);
  assert.match(repairPrompt, /playful assumptions, teasing, and clearly framed social interpretations/i);
});

test('primary, repair, and emergency prompts share the same unknown-ME placeholder state', () => {
  const unknownFavoriteRequest: RepliesRequest = {
    ...request,
    transcriptText: 'ME: I played Dota 2.\nTHEM: What is your favorite game?',
  };
  const primaryPrompt = buildRepliesPrompt(unknownFavoriteRequest);
  const repairPrompt = buildReplyGroundingRepairPrompt(
    unknownFavoriteRequest,
    [{ id: 'invalid', text: 'My favorite game is Valorant.', tone: 'playful' }],
    ['playful'],
    ['ownership_or_grounding'],
  );
  const emergencyPrompt = buildReplyEmergencyPrompt(
    unknownFavoriteRequest,
    ['playful'],
    ['ownership_or_grounding'],
  );

  [primaryPrompt, repairPrompt, emergencyPrompt].forEach((prompt) => {
    assert.match(prompt, /requires user knowledge|not established by the transcript/i);
    assert.match(prompt, /\[your favorite game\]/i);
    assert.match(prompt, /do not (?:guess|use any other)/i);
  });
  assert.match(repairPrompt, /instead of attempting another concrete value/i);
});

test('does not offer a placeholder when the requested ME fact is grounded', () => {
  const groundedFavoriteRequest: RepliesRequest = {
    ...request,
    transcriptText: 'ME: My favorite game is Dota 2.\nTHEM: What is your favorite game?',
  };
  const prompt = buildRepliesPrompt(groundedFavoriteRequest);

  assert.match(prompt, /Do not use bracketed placeholders/i);
  assert.doesNotMatch(prompt, /exactly one editable slot/i);
});

test('vibe-check prompt defines the agreed interest rubric', () => {
  const request: VibeCheckRequest = {
    transcriptText: 'ME: Want to hang out?\nTHEM: That sounds fun 😊\nTHEM: See you soon 😉',
  };
  const prompt = buildVibeCheckPrompt(request);

  assert.match(prompt, /two or more warm\/flirty emojis used by THEM anywhere/i);
  assert.match(prompt, /do not need to be adjacent or in one message/i);
  assert.match(prompt, /playful tease\/joke aimed at ME/i);
  assert.match(prompt, /standalone "haha" or "lol"/i);
  assert.match(prompt, /two or more of THEM's replies are 1–3 words/i);
});

test('active vibe-check prompt uses behavioral interest calibration fixtures', () => {
  const prompt = buildGeminiVibeCheckPrompt({
    transcriptText: 'ME: Want to hang out?\nTHEM: You are super cute. Want to meet?',
  });

  assert.match(prompt, /behavioral intent and actions over surface style/i);
  assert.match(prompt, /Super cute by the way.*Want to meet.*High/i);
  assert.match(prompt, /warm, detailed replies and questions.*Medium/i);
  assert.match(prompt, /many emojis.*not automatically High/i);
  assert.match(prompt, /grab coffee Saturday.*High/i);
  assert.match(prompt, /repeatedly starts playful\/flirty conversations.*High/i);
  assert.match(prompt, /ME is carrying the conversation.*Low or Medium/i);
  assert.match(prompt, /declines a date and offers no alternative.*Low/i);
  assert.match(prompt, /immediately offers another day.*High or strong Medium/i);
  assert.match(prompt, /short chat with no clear romantic evidence.*Medium/i);
  assert.match(prompt, /recent invitation, rejection, or change in investment outweigh older small talk/i);
});

test('active vibe-check schema requires the public interest level', () => {
  assert.deepEqual(geminiVibeCheckSchema.properties.interestLevel, {
    description:
      'The other person\'s romantic interest in ME: Low, Medium, High, or Unclear. Assess behavioral evidence and conversational intent across the sequence, not writing style.',
    enum: ['Low', 'Medium', 'High', 'Unclear'],
    type: 'string',
  });
  assert.ok(geminiVibeCheckSchema.required.includes('interestLevel'));
});
