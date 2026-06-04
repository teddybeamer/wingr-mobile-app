const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';
const DEFAULT_DEEPSEEK_PROVIDER = 'deepinfra';
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20_000;

type OpenRouterTask = 'reply' | 'vibeCheck';

type OpenRouterProviderRouting = {
  only?: string[];
  sort?: 'latency' | 'price' | 'throughput';
};

type OpenRouterSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties?: boolean;
};

type OpenRouterRequestOptions = {
  model: string;
  provider?: OpenRouterProviderRouting;
};

function getOpenRouterApiKey() {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  return apiKey;
}

function getEnv(name: string) {
  const value = Deno.env.get(name)?.trim();

  return value || undefined;
}

function getTaskModel(task: OpenRouterTask) {
  const taskModel =
    task === 'vibeCheck'
      ? getEnv('VIBE_CHECK_MODEL')
      : getEnv('REPLY_MODEL');

  return taskModel ?? getEnv('DEEPSEEK_MODEL') ?? getEnv('OPENROUTER_MODEL') ?? DEFAULT_DEEPSEEK_MODEL;
}

function normalizeProviderSlug(provider: string) {
  return provider.trim().toLowerCase();
}

function getProviderSlugs(provider: string) {
  return provider
    .split(',')
    .map(normalizeProviderSlug)
    .filter(Boolean);
}

function getTaskProvider(task: OpenRouterTask) {
  const taskProvider =
    task === 'vibeCheck'
      ? getEnv('VIBE_CHECK_PROVIDER')
      : getEnv('REPLY_PROVIDER');

  return taskProvider ?? getEnv('DEEPSEEK_PROVIDER') ?? getEnv('OPENROUTER_PROVIDER') ?? DEFAULT_DEEPSEEK_PROVIDER;
}

function getPrimaryRequestOptions(task: OpenRouterTask): OpenRouterRequestOptions {
  const providerSlugs = getProviderSlugs(getTaskProvider(task));

  return {
    model: getTaskModel(task),
    provider: providerSlugs.length > 0 ? { only: providerSlugs } : undefined,
  };
}

function getLatencyFallbackRequestOptions(task: OpenRouterTask): OpenRouterRequestOptions {
  return {
    model: getTaskModel(task),
    provider: { sort: 'latency' },
  };
}

function getOpenRouterTimeoutMs() {
  const timeoutMs = Number(getEnv('OPENROUTER_TIMEOUT_MS'));

  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_OPENROUTER_TIMEOUT_MS;
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (entry && typeof entry === 'object' && 'text' in entry && typeof entry.text === 'string') {
          return entry.text;
        }

        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

export async function callOpenRouterStructured<T>({
  prompt,
  schema,
  schemaName,
  task,
}: {
  prompt: string;
  schema: OpenRouterSchema;
  schemaName: string;
  task?: OpenRouterTask;
}): Promise<T> {
  const apiKey = getOpenRouterApiKey();
  const requestTask = task ?? 'reply';

  try {
    return await callOpenRouterStructuredOnce<T>({
      apiKey,
      prompt,
      schema,
      schemaName,
      ...getPrimaryRequestOptions(requestTask),
    });
  } catch (primaryError) {
    console.warn('OpenRouter primary provider failed, retrying with latency routing.', primaryError);

    return callOpenRouterStructuredOnce<T>({
      apiKey,
      prompt,
      schema,
      schemaName,
      ...getLatencyFallbackRequestOptions(requestTask),
    });
  }
}

async function callOpenRouterStructuredOnce<T>({
  apiKey,
  model,
  prompt,
  provider,
  schema,
  schemaName,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  provider?: OpenRouterProviderRouting;
  schema: OpenRouterSchema;
  schemaName: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getOpenRouterTimeoutMs());

  let response: Response | null = null;

  try {
    response = await fetch(OPENROUTER_URL, {
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You are Wingr AI. Return concise, emotionally intelligent output that strictly matches the required JSON schema.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model,
        ...(provider ? { provider } : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response) {
    throw new Error('OpenRouter request did not return a response.');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter request failed with ${response.status}: ${text}`);
  }

  const payload = await response.json();
  const content = extractTextContent(payload?.choices?.[0]?.message?.content);

  if (!content) {
    throw new Error('OpenRouter returned an empty response.');
  }

  return JSON.parse(content) as T;
}
