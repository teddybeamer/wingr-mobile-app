import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOwnershipCheckedReplies,
  getReplyOwnershipValidationTrace,
  getTerminalFallbackReply,
} from './reply-ownership.ts';
import { getReplyAnswerability } from './reply-answerability.ts';
import { buildReplyFactLedger } from './reply-fact-ledger.ts';
import type { RepliesRequest } from './types.ts';

const request: RepliesRequest = {
  selectedTone: 'direct',
  transcriptText: 'THEM: That sounds like a lot.',
  vibeCheck: {
    bestTone: 'direct',
    conversationEnergy: 'They asked a direct question.',
    interestLevel: 'Medium',
    risk: 'Do not over-explain.',
    summary: 'Answer naturally.',
  },
};

function favoriteGameRequest(
  themText = 'What’s your favorite game?',
  meText?: string,
  targetLanguage = 'English',
): RepliesRequest {
  const messages = [
    ...(meText
      ? [{
        boundingBox: { height: 20, width: 300, x: 180, y: 10 },
        confidence: 0.98,
        id: 'me-1',
        sender: 'me' as const,
        speaker: 'user' as const,
        text: meText,
        xPosition: 'right' as const,
      }]
      : []),
    {
      boundingBox: { height: 20, width: 300, x: 10, y: 40 },
      confidence: 0.98,
      id: 'them-1',
      sender: 'them' as const,
      speaker: 'other' as const,
      text: themText,
      xPosition: 'left' as const,
    },
  ];

  return {
    ...request,
    parsedConversation: {
      latestMessageSender: 'them',
      messages,
      shouldGenerateDirectReply: true,
      speakerAttributionConfidence: 0.98,
    },
    transcriptText: messages.map((message) =>
      `${message.sender === 'me' ? 'ME' : 'THEM'}: ${message.text}`
    ).join('\n'),
    vibeCheck: { ...request.vibeCheck, targetLanguage },
  };
}

function structuredFactRequest(
  meText: string,
  themText: string,
  targetLanguage = 'English',
): RepliesRequest {
  const messages = [
    {
      boundingBox: { height: 20, width: 300, x: 180, y: 10 },
      confidence: 0.98,
      id: 'me-fact',
      sender: 'me' as const,
      speaker: 'user' as const,
      text: meText,
      xPosition: 'right' as const,
    },
    {
      boundingBox: { height: 20, width: 300, x: 10, y: 40 },
      confidence: 0.97,
      id: 'them-fact',
      sender: 'them' as const,
      speaker: 'other' as const,
      text: themText,
      xPosition: 'left' as const,
    },
  ];

  return {
    ...request,
    parsedConversation: {
      latestMessageSender: 'them',
      messages,
      shouldGenerateDirectReply: true,
      speakerAttributionConfidence: 0.98,
    },
    transcriptText: messages.map((message) =>
      `${message.sender === 'me' ? 'ME' : 'THEM'}: ${message.text}`
    ).join('\n'),
    vibeCheck: { ...request.vibeCheck, targetLanguage },
  };
}

test('keeps light conversational inferences and neutral follow-ups', () => {
  [
    'Sounds like you’re getting the full family interrogation 😂',
    'Okay, so what’s the story there?',
    'I’m choosing to believe that was a compliment.',
    'You seem suspiciously confident about that.',
  ].forEach((text, index) => {
    const replies = getOwnershipCheckedReplies(
      [{ id: `reply-${index}`, text, tone: 'playful' }],
      request,
    );

    assert.equal(replies[0]?.text, text);
  });
});

test('uses one minimal language-aware terminal fallback', () => {
  assert.equal(getTerminalFallbackReply(request).text, 'Okay, tell me more 👀');
  assert.equal(getTerminalFallbackReply({
    ...request,
    vibeCheck: { ...request.vibeCheck, targetLanguage: 'Danish' },
  }).text, 'Fortæl mig lidt mere.');
});

test('accepts harmless Playful inference while recording the ME-only lexical overlap as advisory', () => {
  const conversationRequest: RepliesRequest = {
    ...request,
    parsedConversation: {
      latestMessageSender: 'them',
      messages: [
        {
          boundingBox: { height: 20, width: 300, x: 10, y: 10 },
          confidence: 0.98,
          id: 'me-1',
          sender: 'me',
          speaker: 'user',
          text: 'I am very competitive.',
          xPosition: 'right',
        },
        {
          boundingBox: { height: 20, width: 300, x: 10, y: 40 },
          confidence: 0.98,
          id: 'them-1',
          sender: 'them',
          speaker: 'other',
          text: 'Haha, I can tell.',
          xPosition: 'left',
        },
      ],
      shouldGenerateDirectReply: true,
      speakerAttributionConfidence: 0.98,
    },
    transcriptText: [
      'ME: I am very competitive.',
      'THEM: Haha, I can tell.',
    ].join('\n'),
  };

  const candidate = { id: 'reply-1', text: 'You sound competitive too, huh? 👀', tone: 'playful' as const };
  const replies = getOwnershipCheckedReplies(
    [candidate],
    conversationRequest,
  );

  assert.deepEqual(replies, [candidate]);
  assert.equal(getReplyOwnershipValidationTrace([candidate], conversationRequest).meFactDirectedAtThemDetected, true);
});

test('still rejects unsupported first-person ownership claims', () => {
  const replies = getOwnershipCheckedReplies(
    [{ id: 'reply-1', text: 'I love dogs too.', tone: 'playful' }],
    {
      ...request,
      contextNotes: { replyInstruction: [], situationNotes: [], themFacts: ['They have a dog.'], userFacts: [] },
    },
  );

  assert.deepEqual(replies, []);
});

test('keeps a THEM-only fact available as a safe question hook', () => {
  const replies = getOwnershipCheckedReplies(
    [{ id: 'reply-1', text: 'How is your roommate visit going?', tone: 'direct' }],
    {
      ...request,
      parsedConversation: {
        latestMessageSender: 'them',
        messages: [
          {
            boundingBox: { height: 20, width: 300, x: 10, y: 10 },
            confidence: 0.98,
            id: 'me-1',
            sender: 'me',
            speaker: 'user',
            text: 'I am away with my brothers.',
            xPosition: 'right',
          },
          {
            boundingBox: { height: 20, width: 300, x: 10, y: 40 },
            confidence: 0.98,
            id: 'them-1',
            sender: 'them',
            speaker: 'other',
            text: 'My former roommate is visiting.',
            xPosition: 'left',
          },
        ],
        shouldGenerateDirectReply: true,
        speakerAttributionConfidence: 0.98,
      },
      transcriptText: 'ME: I am away with my brothers.\nTHEM: My former roommate is visiting.',
    },
  );

  assert.equal(replies[0]?.text, 'How is your roommate visit going?');
});

test('builds a provenance-bearing ledger and permits a grounded ME fact', () => {
  const factRequest = structuredFactRequest(
    'I played Dota 2 last night.',
    'I usually play Valorant.',
  );
  const ledger = buildReplyFactLedger(factRequest);
  const meFact = ledger.facts.find((fact) => fact.owner === 'me');
  const candidate = { id: 'ledger-me', text: 'I played Dota 2 last night.', tone: 'direct' as const };

  assert.equal(meFact?.normalizedValue, 'played dota 2 last night');
  assert.equal(meFact?.confidence, 0.95);
  assert.deepEqual(meFact?.provenance, {
    messageId: 'me-fact',
    messageIndex: 0,
    source: 'structured_message',
  });
  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), [candidate]);
});

test('adds explicit context facts with ownership provenance', () => {
  const factRequest: RepliesRequest = {
    ...request,
    contextNotes: {
      replyInstruction: [],
      situationNotes: [],
      themFacts: ['They work at a hospital.'],
      userFacts: ['I work at a bakery downtown.'],
    },
  };
  const ledger = buildReplyFactLedger(factRequest);
  const userFact = ledger.facts.find((fact) => fact.owner === 'me');
  const candidate = {
    id: 'context-grounded',
    text: 'I work at a bakery downtown.',
    tone: 'direct' as const,
  };

  assert.deepEqual(userFact?.provenance, { factIndex: 0, source: 'user_fact' });
  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), [candidate]);
});

test('rejects a high-confidence structured THEM fact transferred to ME', () => {
  const factRequest = structuredFactRequest(
    'That sounds like a nice evening.',
    'I am having dinner with friends tonight.',
  );
  const candidate = {
    id: 'ledger-reversal',
    text: 'I am having dinner with friends tonight.',
    tone: 'direct' as const,
  };

  assert.deepEqual(
    getReplyOwnershipValidationTrace([candidate], factRequest).rejectionCodes,
    ['fact_owner_reversal'],
  );
  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), []);
});

test('rejects a clear unsupported concrete ME fact absent from the ledger', () => {
  const factRequest = structuredFactRequest(
    'That sounds interesting.',
    'What are you focused on lately?',
  );
  const candidate = {
    id: 'ledger-unsupported',
    text: 'I am training for a marathon this spring.',
    tone: 'direct' as const,
  };

  assert.deepEqual(
    getReplyOwnershipValidationTrace([candidate], factRequest).rejectionCodes,
    ['unsupported_me_fact'],
  );
  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), []);
});

test('does not block shared vocabulary without a clear fact reversal', () => {
  const factRequest = structuredFactRequest(
    'I had lunch with friends yesterday.',
    'I am having dinner with friends tonight.',
  );
  const candidate = {
    id: 'ledger-shared',
    text: 'I love catching up with friends too.',
    tone: 'playful' as const,
  };

  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), [candidate]);
});

test('keeps harmless inference and questions about THEM non-blocking', () => {
  const factRequest = structuredFactRequest(
    'I play Dota 2 after work.',
    'I usually play Valorant.',
  );
  const inference = {
    id: 'ledger-inference',
    text: 'I’m choosing to believe that was a compliment.',
    tone: 'playful' as const,
  };
  const question = {
    id: 'ledger-question',
    text: 'Do you play Dota 2 after work too?',
    tone: 'direct' as const,
  };
  const reaction = {
    id: 'ledger-reaction',
    text: 'I appreciate you saying that.',
    tone: 'direct' as const,
  };

  assert.deepEqual(getOwnershipCheckedReplies([inference], factRequest), [inference]);
  assert.deepEqual(getOwnershipCheckedReplies([question], factRequest), [question]);
  assert.deepEqual(getOwnershipCheckedReplies([reaction], factRequest), [reaction]);
});

test('does not hard-block a claim based on low-confidence ownership evidence', () => {
  const factRequest = structuredFactRequest(
    'That sounds good.',
    'I am having dinner with friends tonight.',
  );
  factRequest.parsedConversation!.messages[1].confidence = 0.6;
  const candidate = {
    id: 'ledger-low-confidence',
    text: 'I am having dinner with friends tonight.',
    tone: 'direct' as const,
  };

  assert.deepEqual(getOwnershipCheckedReplies([candidate], factRequest), [candidate]);
});

test('applies the conservative fact ledger to equivalent Danish claims', () => {
  const factRequest = structuredFactRequest(
    'Jeg spiller Dota 2.',
    'Jeg spiser middag med venner i aften.',
    'Danish',
  );
  const grounded = { id: 'da-grounded', text: 'Jeg spiller Dota 2.', tone: 'direct' as const };
  const reversed = {
    id: 'da-reversed',
    text: 'Jeg spiser middag med venner i aften.',
    tone: 'direct' as const,
  };
  const unsupported = {
    id: 'da-unsupported',
    text: 'Jeg træner til et maraton næste måned.',
    tone: 'direct' as const,
  };

  assert.deepEqual(getOwnershipCheckedReplies([grounded], factRequest), [grounded]);
  assert.deepEqual(
    getReplyOwnershipValidationTrace([reversed], factRequest).rejectionCodes,
    ['fact_owner_reversal'],
  );
  assert.deepEqual(
    getReplyOwnershipValidationTrace([unsupported], factRequest).rejectionCodes,
    ['unsupported_me_fact'],
  );
});

test('accepts an exact descriptive placeholder for an unknown ME favorite', () => {
  const unknownFavoriteRequest = favoriteGameRequest();
  const candidate = {
    id: 'reply-1',
    text: "I'd probably say [your favorite game] — what do you usually play?",
    tone: 'direct' as const,
  };
  const trace = getReplyOwnershipValidationTrace([candidate], unknownFavoriteRequest);

  assert.equal(getReplyAnswerability(unknownFavoriteRequest).answerability, 'requires_user_knowledge');
  assert.deepEqual(getOwnershipCheckedReplies([candidate], unknownFavoriteRequest), [candidate]);
  assert.equal(trace.containedAllowedPlaceholder, true);
  assert.equal(trace.rejectionCodes.length, 0);
});

test('still rejects a concrete favorite answer when the ME fact is unknown', () => {
  const unknownFavoriteRequest = favoriteGameRequest();
  const candidate = {
    id: 'reply-1',
    text: 'My favorite game is Valorant.',
    tone: 'direct' as const,
  };
  const trace = getReplyOwnershipValidationTrace([candidate], unknownFavoriteRequest);

  assert.deepEqual(getOwnershipCheckedReplies([candidate], unknownFavoriteRequest), []);
  assert.equal(trace.unsupportedUnknownMeFactClaimDetected, true);
  assert.deepEqual(trace.rejectionCodes, ['unsupported_me_fact']);
});

test('reports privacy-safe typed rejection codes only where the cause is deterministic', () => {
  const cases: Array<{
    expected: string[];
    replyText: string;
    validationRequest: RepliesRequest;
  }> = [
    {
      expected: ['fact_owner_reversal'],
      replyText: 'My former roommate is visiting too.',
      validationRequest: {
        ...request,
        contextNotes: {
          replyInstruction: [],
          situationNotes: [],
          themFacts: ['Their former roommate is visiting.'],
          userFacts: [],
        },
      },
    },
    {
      expected: ['unsupported_name'],
      replyText: 'Morgan, tell me more.',
      validationRequest: request,
    },
    {
      expected: ['ocr_noise'],
      replyText: 'Tell me more about that ZXCVBN.',
      validationRequest: request,
    },
    {
      expected: ['wrong_speaker'],
      replyText: 'As the other person, I would say yes.',
      validationRequest: request,
    },
    {
      expected: ['ownership_or_grounding'],
      replyText: 'Thanks for telling me.',
      validationRequest: request,
    },
  ];

  cases.forEach(({ expected, replyText, validationRequest }, index) => {
    const candidate = { id: `typed-${index}`, text: replyText, tone: 'direct' as const };

    assert.deepEqual(
      getReplyOwnershipValidationTrace([candidate], validationRequest).rejectionCodes,
      expected,
    );
    assert.deepEqual(getOwnershipCheckedReplies([candidate], validationRequest), []);
  });
});

test('uses a grounded favorite normally without a placeholder', () => {
  const groundedFavoriteRequest = favoriteGameRequest(
    'What is your favorite game?',
    'My favorite game is Dota 2.',
  );
  const candidate = {
    id: 'reply-1',
    text: 'Dota 2 for sure — have you tried it yet?',
    tone: 'direct' as const,
  };

  assert.equal(getReplyAnswerability(groundedFavoriteRequest).answerability, 'answerable_from_transcript');
  assert.deepEqual(getOwnershipCheckedReplies([candidate], groundedFavoriteRequest), [candidate]);
});

test('treats a strong established preference as enough favorite evidence', () => {
  const groundedFavoriteRequest = favoriteGameRequest(
    'What is your favorite game?',
    "I'm obsessed with Dota 2.",
  );

  assert.equal(getReplyAnswerability(groundedFavoriteRequest).answerability, 'answerable_from_transcript');
});

test('does not enable placeholder behavior for a normal answerable question', () => {
  const normalQuestionRequest = favoriteGameRequest('Did you enjoy the movie?');
  const normalCandidate = { id: 'reply-1', text: 'Okay, so what’s the story there?', tone: 'direct' as const };
  const placeholderCandidate = { id: 'reply-2', text: 'Yeah, [your favorite movie].', tone: 'direct' as const };

  assert.equal(getReplyAnswerability(normalQuestionRequest).answerability, 'not_applicable');
  assert.deepEqual(getOwnershipCheckedReplies([normalCandidate], normalQuestionRequest), [normalCandidate]);
  assert.deepEqual(getOwnershipCheckedReplies([placeholderCandidate], normalQuestionRequest), []);
});

test('does not let an allowed placeholder bypass existing deterministic failures', () => {
  const unknownFavoriteRequest = favoriteGameRequest();
  const candidates = [
    "Morgan, I'd probably say [your favorite game].",
    "I'd probably say [your favorite game] ZXCVBN.",
    "As the other person, I'd probably say [your favorite game].",
  ].map((text, index) => ({ id: `reply-${index}`, text, tone: 'direct' as const }));

  candidates.forEach((candidate) => {
    assert.deepEqual(getOwnershipCheckedReplies([candidate], unknownFavoriteRequest), []);
  });
});

test('accepts the exact Danish placeholder for an unknown ME favorite', () => {
  const danishRequest = favoriteGameRequest('Hvad er dit yndlingsspil?', undefined, 'Danish');
  const candidate = {
    id: 'reply-1',
    text: 'Jeg ville nok sige [dit yndlingsspil] — hvad med dig?',
    tone: 'direct' as const,
  };

  assert.equal(getReplyAnswerability(danishRequest).answerability, 'requires_user_knowledge');
  assert.deepEqual(getOwnershipCheckedReplies([candidate], danishRequest), [candidate]);
});

test('uses narrowly defined descriptive slots for common unknown ME-fact questions', () => {
  [
    ['What do you do for work?', '[your job]'],
    ['Where are you from?', '[your hometown]'],
    ['What are you doing this weekend?', '[your plans]'],
    ['What are you looking for?', "[what you're looking for]"],
  ].forEach(([question, placeholder], index) => {
    const questionRequest = favoriteGameRequest(question);
    const answerability = getReplyAnswerability(questionRequest);
    const candidate = {
      id: `reply-${index}`,
      text: `Probably ${placeholder} — what about you?`,
      tone: 'direct' as const,
    };

    assert.equal(answerability.answerability, 'requires_user_knowledge');
    assert.equal(answerability.placeholder, placeholder);
    assert.deepEqual(getOwnershipCheckedReplies([candidate], questionRequest), [candidate]);
  });
});

test('chooses the latest unknown ME fact in the supplied multi-question chat turn', () => {
  const physicalCaseRequest = favoriteGameRequest(
    'I had not heard of Dota 2 before. What’s your favorite game? What are you up to this weekend?',
  );
  const answerability = getReplyAnswerability(physicalCaseRequest);

  assert.equal(answerability.answerability, 'requires_user_knowledge');
  assert.equal(answerability.factKind, 'plans');
  assert.equal(answerability.placeholder, '[your plans]');
});

test('rejects vague or mismatched placeholders and never enables an old THEM question after ME replies', () => {
  const unknownFavoriteRequest = favoriteGameRequest();
  const vagueCandidate = { id: 'reply-1', text: 'Probably [something].', tone: 'direct' as const };
  const malformedCandidate = { id: 'reply-2', text: 'Probably [your favorite game.', tone: 'direct' as const };
  const latestMeRequest = favoriteGameRequest();
  latestMeRequest.parsedConversation!.messages.push({
    boundingBox: { height: 20, width: 300, x: 180, y: 70 },
    confidence: 0.98,
    id: 'me-latest',
    sender: 'me',
    speaker: 'user',
    text: 'Let me think about that.',
    xPosition: 'right',
  });
  latestMeRequest.parsedConversation!.latestMessageSender = 'me';
  latestMeRequest.parsedConversation!.shouldGenerateDirectReply = false;

  assert.deepEqual(getOwnershipCheckedReplies([vagueCandidate], unknownFavoriteRequest), []);
  assert.deepEqual(getOwnershipCheckedReplies([malformedCandidate], unknownFavoriteRequest), []);
  assert.equal(getReplyAnswerability(latestMeRequest).answerability, 'not_applicable');
});

test('uses a contextual deterministic placeholder fallback only for unknown ME facts', () => {
  assert.equal(
    getTerminalFallbackReply(favoriteGameRequest()).text,
    "I'd probably say [your favorite game] — what about you?",
  );
  assert.equal(getTerminalFallbackReply(request).text, 'Okay, tell me more 👀');
});
