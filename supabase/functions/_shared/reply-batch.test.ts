import assert from 'node:assert/strict';
import test from 'node:test';
import { generateReplyBatch } from './reply-batch.ts';
import type { RepliesRequest, SuggestedReply } from './types.ts';

const originalFetch = globalThis.fetch;
const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
const originalDateNow = Date.now;

type MockResponse = Error | unknown;

function responseForPayload(payload: unknown) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  }), { status: 200 });
}

function responseFor(reply: SuggestedReply) {
  return responseForPayload({ replyBatch: { [reply.tone]: [reply] } });
}

function withOpenRouterMocks(
  responses: MockResponse[],
  run: (requests: RequestInit[]) => Promise<void>,
) {
  const requests: RequestInit[] = [];
  let responseIndex = 0;
  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: (name) => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined },
  };
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    const response = responses[responseIndex++];
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error('Unexpected additional OpenRouter request.');
    return responseForPayload(response);
  };

  return run(requests).finally(() => {
    globalThis.fetch = originalFetch;
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  });
}

const request: RepliesRequest = {
  selectedTone: 'casualSmallTalk',
  transcriptText: 'ME: I had a busy day.\nTHEM: That sounds like a lot.',
  vibeCheck: {
    bestTone: 'casualSmallTalk',
    conversationEnergy: 'Warm',
    interestLevel: 'Medium',
    risk: 'Keep it grounded.',
    summary: 'They replied.',
    targetLanguage: 'English',
  },
};

function reply(text: string): SuggestedReply {
  return { id: 'reply-1', text, tone: 'casualSmallTalk' };
}

test('returns a primary reply after unified validation succeeds', async () => {
  await withOpenRouterMocks([{ replyBatch: { casualSmallTalk: [reply('That does sound like a lot.')] } }], async (requests) => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(requests.length, 1);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'That does sound like a lot.');
    assert.equal(result.telemetry.finalOutcome, 'success');
    assert.equal(result.telemetry.repairGeneration.triggered, false);
    assert.equal(result.telemetry.terminalFallback.used, false);
  });
});

test('repairs an ownership rejection using the validator reason code', async () => {
  const invalid = reply('Morgan, tell me more.');
  const repaired = reply('That sounds like a lot — are you okay?');
  await withOpenRouterMocks([
    { replyBatch: { casualSmallTalk: [invalid] } },
    { replyBatch: { casualSmallTalk: [repaired] } },
  ], async (requests) => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /ownership_or_grounding/);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, repaired.text);
    assert.equal(result.telemetry.repairGeneration.triggered, true);
    assert.equal(result.telemetry.finalOutcome, 'success');
  });
});

test('repairs a wrong-language reply through the same repair path', async () => {
  const danishRequest = { ...request, vibeCheck: { ...request.vibeCheck, targetLanguage: 'Danish' } };
  await withOpenRouterMocks([
    { replyBatch: { casualSmallTalk: [reply('That sounds like a lot.')] } },
    { replyBatch: { casualSmallTalk: [reply('Det lyder som meget.')] } },
  ], async (requests) => {
    const result = await generateReplyBatch(danishRequest, ['casualSmallTalk']);
    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /wrong_language/);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Det lyder som meget.');
    assert.equal(result.telemetry.finalOutcome, 'success');
  });
});

test('repairs malformed structured output', async () => {
  await withOpenRouterMocks([
    { replyBatch: 'not-a-batch' },
    { replyBatch: { casualSmallTalk: [reply('Fair enough.')] } },
  ], async (requests) => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /structured_output_invalid/);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Fair enough.');
  });
});

test('repairs a missing selected tone', async () => {
  await withOpenRouterMocks([
    { replyBatch: {} },
    { replyBatch: { casualSmallTalk: [reply('Fair enough.')] } },
  ], async (requests) => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /missing_selected_tone/);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Fair enough.');
  });
});

test('uses the terminal fallback only after emergency generation also fails', async () => {
  await withOpenRouterMocks([
    new Error('network down'),
    new Error('network down'),
    new Error('network down'),
    new Error('network down'),
  ], async (requests) => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(requests.length, 4);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Okay, tell me more 👀');
    assert.equal(result.telemetry.finalOutcome, 'fallback');
    assert.equal(result.telemetry.emergencyGeneration.triggered, true);
    assert.equal(result.telemetry.terminalFallback.used, true);
    assert.deepEqual(result.telemetry.terminalFallback.reasonCodes, ['emergency_model_request_failed']);
  });
});

test('uses emergency generation for a direct question and preserves the selected tone', async () => {
  const playfulQuestionRequest: RepliesRequest = {
    ...request,
    selectedTone: 'playful',
    transcriptText: 'ME: I have had a busy week.\nTHEM: What are you doing this weekend?',
    vibeCheck: { ...request.vibeCheck, bestTone: 'playful', targetLanguage: 'English' },
  };
  const invalid = { id: 'invalid', text: 'Morgan, tell me more.', tone: 'playful' as const };
  const emergency = { id: 'emergency', text: 'A bit of both, honestly — what about you? 👀', tone: 'playful' as const };
  await withOpenRouterMocks([
    { replyBatch: { playful: [invalid] } },
    { replyBatch: { playful: [invalid] } },
    { replyBatch: { playful: [emergency] } },
  ], async (requests) => {
    const result = await generateReplyBatch(playfulQuestionRequest, ['playful']);
    assert.equal(requests.length, 3);
    assert.match(String(requests[2]?.body), /Emergency reply generation/);
    assert.equal(result.replyBatch.playful?.[0]?.text, emergency.text);
    assert.equal(result.replyBatch.playful?.[0]?.tone, 'playful');
    assert.equal(result.telemetry.emergencyGeneration.triggered, true);
    assert.equal(result.telemetry.terminalFallback.used, false);
  });
});

test('rejects unsupported emergency ownership output before using terminal fallback', async () => {
  const invalid = reply('Morgan, tell me more.');
  await withOpenRouterMocks([
    { replyBatch: { casualSmallTalk: [invalid] } },
    { replyBatch: { casualSmallTalk: [invalid] } },
    { replyBatch: { casualSmallTalk: [invalid] } },
  ], async () => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Okay, tell me more 👀');
    assert.equal(result.telemetry.terminalFallback.used, true);
    assert.ok(result.telemetry.terminalFallback.reasonCodes.includes('ownership_or_grounding'));
    assert.equal(result.replyBatch.casualSmallTalk?.length, 1);
  });
});

test('uses terminal fallback when emergency generation fails after rejected primary and repair output', async () => {
  const invalid = reply('Morgan, tell me more.');
  await withOpenRouterMocks([
    { replyBatch: { casualSmallTalk: [invalid] } },
    { replyBatch: { casualSmallTalk: [invalid] } },
    new Error('network down'),
    new Error('network down'),
  ], async () => {
    const result = await generateReplyBatch(request, ['casualSmallTalk']);
    assert.equal(result.telemetry.terminalFallback.used, true);
    assert.deepEqual(result.telemetry.terminalFallback.reasonCodes, ['emergency_model_request_failed']);
    assert.equal(result.replyBatch.casualSmallTalk?.length, 1);
  });
});

test('skips repair when the primary result leaves too little total latency budget', async () => {
  let now = 0;
  Date.now = () => now;
  const invalid = reply('Morgan, tell me more.');

  try {
    await withOpenRouterMocks([
      { replyBatch: { casualSmallTalk: [invalid] } },
    ], async (requests) => {
      const originalMockFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        now = 8_500;
        return originalMockFetch(input, init);
      };
      try {
        const result = await generateReplyBatch(request, ['casualSmallTalk']);
        assert.equal(requests.length, 1);
        assert.equal(result.telemetry.repairGeneration.triggered, false);
        assert.deepEqual(result.telemetry.terminalFallback.reasonCodes, ['latency_budget_exhausted']);
        assert.equal(result.replyBatch.casualSmallTalk?.length, 1);
      } finally {
        globalThis.fetch = originalMockFetch;
      }
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test('skips emergency generation when repair leaves too little total latency budget', async () => {
  let now = 0;
  Date.now = () => now;
  const invalid = reply('Morgan, tell me more.');

  try {
    await withOpenRouterMocks([
      { replyBatch: { casualSmallTalk: [invalid] } },
      { replyBatch: { casualSmallTalk: [invalid] } },
    ], async (requests) => {
      const originalMockFetch = globalThis.fetch;
      let fetchCount = 0;
      globalThis.fetch = async (input, init) => {
        fetchCount += 1;
        if (fetchCount === 2) now = 8_500;
        return originalMockFetch(input, init);
      };
      try {
        const result = await generateReplyBatch(request, ['casualSmallTalk']);
        assert.equal(requests.length, 2);
        assert.equal(result.telemetry.emergencyGeneration.triggered, false);
        assert.deepEqual(result.telemetry.terminalFallback.reasonCodes, ['latency_budget_exhausted']);
        assert.equal(result.replyBatch.casualSmallTalk?.length, 1);
      } finally {
        globalThis.fetch = originalMockFetch;
      }
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test('returns an unknown-ME placeholder from primary generation without recovery latency', async () => {
  const unknownFavoriteRequest: RepliesRequest = {
    ...request,
    selectedTone: 'playful',
    transcriptText: 'ME: I played Dota 2.\nTHEM: What is your favorite game?',
    vibeCheck: { ...request.vibeCheck, bestTone: 'playful', targetLanguage: 'English' },
  };
  const placeholderReply = {
    id: 'placeholder',
    text: "I'd probably say [your favorite game] — have you tried Dota yet?",
    tone: 'playful' as const,
  };

  await withOpenRouterMocks([
    { replyBatch: { playful: [placeholderReply] } },
  ], async (requests) => {
    const result = await generateReplyBatch(unknownFavoriteRequest, ['playful']);

    assert.equal(requests.length, 1);
    assert.equal(result.replyBatch.playful?.[0]?.text, placeholderReply.text);
    assert.equal(result.telemetry.answerability.latestThemRequiresUnknownMeFact, true);
    assert.equal(result.telemetry.answerability.placeholderGenerationAllowed, true);
    assert.equal(result.telemetry.returnedStage, 'primary_generation');
    assert.equal(result.telemetry.repairGeneration.triggered, false);
    assert.equal(result.telemetry.emergencyGeneration.triggered, false);
  });
});

test('repairs an invented unknown ME favorite with the exact allowed placeholder', async () => {
  const unknownFavoriteRequest: RepliesRequest = {
    ...request,
    selectedTone: 'playful',
    transcriptText: 'ME: I played Dota 2.\nTHEM: What is your favorite game?',
    vibeCheck: { ...request.vibeCheck, bestTone: 'playful', targetLanguage: 'English' },
  };
  const invalid = { id: 'invalid', text: 'My favorite game is Valorant.', tone: 'playful' as const };
  const repaired = { id: 'repaired', text: '[your favorite game] for sure — what about you?', tone: 'playful' as const };

  await withOpenRouterMocks([
    { replyBatch: { playful: [invalid] } },
    { replyBatch: { playful: [repaired] } },
  ], async (requests) => {
    const result = await generateReplyBatch(unknownFavoriteRequest, ['playful']);

    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /\[your favorite game\]/i);
    assert.equal(result.replyBatch.playful?.[0]?.text, repaired.text);
    assert.equal(result.telemetry.returnedStage, 'repair_generation');
  });
});

test('uses a deterministic contextual placeholder after repeated invalid unknown-ME answers', async () => {
  const unknownFavoriteRequest: RepliesRequest = {
    ...request,
    selectedTone: 'playful',
    transcriptText: 'ME: I played Dota 2.\nTHEM: What is your favorite game?',
    vibeCheck: { ...request.vibeCheck, bestTone: 'playful', targetLanguage: 'English' },
  };
  const invalid = { id: 'invalid', text: 'My favorite game is Valorant.', tone: 'playful' as const };

  await withOpenRouterMocks([
    { replyBatch: { playful: [invalid] } },
    { replyBatch: { playful: [invalid] } },
    { replyBatch: { playful: [invalid] } },
  ], async (requests) => {
    const result = await generateReplyBatch(unknownFavoriteRequest, ['playful']);

    assert.equal(requests.length, 3);
    assert.equal(
      result.replyBatch.playful?.[0]?.text,
      "I'd probably say [your favorite game] — what about you?",
    );
    assert.equal(result.telemetry.finalOutcome, 'fallback');
    assert.equal(result.telemetry.returnedStage, 'terminal_fallback');
    assert.equal(result.telemetry.terminalFallback.used, true);
  });
});
