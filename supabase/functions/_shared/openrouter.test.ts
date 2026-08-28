import assert from 'node:assert/strict';
import test from 'node:test';
import { callOpenRouterStructured } from './openrouter.ts';

const originalFetch = globalThis.fetch;
const originalDeno = (globalThis as typeof globalThis & { Deno?: unknown }).Deno;
const originalDateNow = Date.now;

const schema = {
  additionalProperties: false,
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  type: 'object' as const,
};

test('retries a DeepInfra-only reply request with privacy-preserving latency routing', async () => {
  const requests: RequestInit[] = [];
  let requestCount = 0;

  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: (name) => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined },
  };
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    requestCount += 1;

    if (requestCount === 1) {
      return new Response(null, { status: 503 });
    }

    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: 'ok' }) } }],
      openrouter_metadata: {
        endpoints: { available: [{ provider: 'DeepInfra', selected: true }] },
      },
    }), { status: 200 });
  };

  try {
    const result = await callOpenRouterStructured<{ reply: string }>({
      prompt: 'test prompt',
      schema,
      schemaName: 'reply',
    });

    assert.deepEqual(result, { reply: 'ok' });
    assert.equal(requests.length, 2);

    const primary = JSON.parse(String(requests[0]?.body));
    const fallback = JSON.parse(String(requests[1]?.body));

    assert.deepEqual(primary.provider, {
      allow_fallbacks: false,
      data_collection: 'deny',
      only: ['deepinfra'],
      zdr: true,
    });
    assert.deepEqual(fallback.provider, {
      data_collection: 'deny',
      sort: 'latency',
      zdr: true,
    });
    assert.equal(
      (requests[1]?.headers as Record<string, string>)['x-openrouter-metadata'],
      'enabled',
    );
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  }
});

test('does not retry another provider after a successful response has invalid JSON content', async () => {
  let requestCount = 0;
  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: (name) => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined },
  };
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 });
  };

  try {
    await assert.rejects(() => callOpenRouterStructured({ prompt: 'test prompt', schema, schemaName: 'reply' }));
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  }
});

test('skips latency-sorted provider fallback when the total deadline has insufficient time left', async () => {
  let now = 0;
  let requestCount = 0;
  Date.now = () => now;
  (globalThis as typeof globalThis & { Deno: { env: { get: (name: string) => string | undefined } } }).Deno = {
    env: { get: (name) => name === 'OPENROUTER_API_KEY' ? 'test-key' : undefined },
  };
  globalThis.fetch = async () => {
    requestCount += 1;
    now = 10_000;
    return new Response(null, { status: 503 });
  };

  try {
    await assert.rejects(() => callOpenRouterStructured({
      deadlineAt: 11_000,
      minLatencyFallbackWindowMs: 2_000,
      prompt: 'test prompt',
      schema,
      schemaName: 'reply',
    }));
    assert.equal(requestCount, 1);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    (globalThis as typeof globalThis & { Deno?: unknown }).Deno = originalDeno;
  }
});
