import assert from 'node:assert/strict';
import test from 'node:test';
import { generateReplyBatch } from './reply-batch.ts';
import type { RepliesRequest, SuggestedReply } from './types.ts';

const originalFetch = globalThis.fetch;
const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;

function responseFor(reply: SuggestedReply) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ replyBatch: { [reply.tone]: [reply] } }) } }],
  }), { status: 200 });
}

function withOpenRouterMocks(
  replies: SuggestedReply[],
  run: (requests: RequestInit[]) => Promise<void>,
) {
  const requests: RequestInit[] = [];
  let responseIndex = 0;

  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: (name) => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined },
  };
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    const reply = replies[responseIndex++];

    if (!reply) {
      throw new Error('Unexpected additional OpenRouter request.');
    }

    return responseFor(reply);
  };

  return run(requests).finally(() => {
    globalThis.fetch = originalFetch;
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  });
}

const danishOwnershipRequest: RepliesRequest = {
  selectedTone: 'casualSmallTalk',
  transcriptText: [
    'ME: Jeg er på fjellet og skulle bygge en ishytte.',
    'THEM: Håber du overlever stormen.',
  ].join('\n'),
  vibeCheck: {
    bestTone: 'casualSmallTalk',
    conversationEnergy: 'Warm',
    interestLevel: 'Medium',
    risk: 'Keep it grounded.',
    summary: 'They replied.',
    targetLanguage: 'Danish',
  },
  parsedConversation: {
    latestMessageSender: 'them',
    messages: [
      {
        boundingBox: { height: 20, width: 300, x: 300, y: 10 },
        confidence: 0.98,
        id: 'me-1',
        sender: 'me',
        speaker: 'user',
        text: 'Jeg er på fjellet og skulle bygge en ishytte.',
        xPosition: 'right',
      },
      {
        boundingBox: { height: 20, width: 300, x: 10, y: 40 },
        confidence: 0.98,
        id: 'them-1',
        sender: 'them',
        speaker: 'other',
        text: 'Håber du overlever stormen.',
        xPosition: 'left',
      },
    ],
    shouldGenerateDirectReply: true,
    speakerAttributionConfidence: 0.98,
  },
};

test('uses a localized Danish fallback after two ownership rejections without language repair', async () => {
  const rejectedReply: SuggestedReply = {
    id: 'invalid-1',
    text: 'Har I fundet på noget andet i stedet for ishytten?',
    tone: 'casualSmallTalk',
  };

  await withOpenRouterMocks([rejectedReply, rejectedReply], async (requests) => {
    const result = await generateReplyBatch(danishOwnershipRequest, ['casualSmallTalk']);

    assert.equal(requests.length, 2);
    assert.match(String(requests[1]?.body), /me_fact_directed_at_them/);
    assert.equal(result.replyBatch.casualSmallTalk?.[0]?.text, 'Måske... hvad tænker du på?');
    assert.equal(result.telemetry.finalOutcome, 'fallback');
    assert.equal(result.telemetry.languageRepair.triggered, false);
    assert.equal(result.telemetry.groundingRepair.attemptCount, 1);
  });
});

test('successful Casual and Playful generation each use one model call', async () => {
  for (const tone of ['casualSmallTalk', 'playful'] as const) {
    const reply: SuggestedReply = {
      id: `${tone}-1`,
      text: tone === 'playful' ? 'haha that does sound tempting 👀' : 'That sounds nice.',
      tone,
    };

    await withOpenRouterMocks([reply], async (requests) => {
      const result = await generateReplyBatch({
        ...danishOwnershipRequest,
        selectedTone: tone,
        vibeCheck: { ...danishOwnershipRequest.vibeCheck, targetLanguage: 'English' },
      }, [tone]);

      assert.equal(requests.length, 1);
      assert.equal(result.telemetry.initialGeneration.attemptCount, 1);
      assert.equal(result.telemetry.groundingRepair.triggered, false);
      assert.equal(result.telemetry.languageRepair.triggered, false);
      assert.equal(result.telemetry.finalOutcome, 'success');
    });
  }
});
