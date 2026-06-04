import {
  estimateTokens,
  getEstimatedTokenBudget,
  getRequestTypeLabel,
} from './prompt-budget.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';
const DEFAULT_VIBE_CHECK_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20_000;
const WINGR_SYSTEM_PROMPT =
  'You are Wingr AI. Return concise, emotionally intelligent output that strictly matches the required JSON schema.';

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

type OpenRouterAttempt = 'primary' | 'latencyFallback';

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

  if (task === 'vibeCheck') {
    return taskModel ?? getEnv('OPENROUTER_VIBE_CHECK_MODEL') ?? DEFAULT_VIBE_CHECK_MODEL;
  }

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

  if (task === 'vibeCheck') {
    return taskProvider ?? getEnv('OPENROUTER_VIBE_CHECK_PROVIDER');
  }

  return taskProvider ?? getEnv('DEEPSEEK_PROVIDER') ?? getEnv('OPENROUTER_PROVIDER');
}

function getPrimaryRequestOptions(task: OpenRouterTask): OpenRouterRequestOptions {
  const taskProvider = getTaskProvider(task);
  const providerSlugs = taskProvider ? getProviderSlugs(taskProvider) : [];
  const provider =
    providerSlugs.length > 0
      ? { only: providerSlugs }
      : task === 'reply'
        ? { sort: 'latency' as const }
        : undefined;

  return {
    model: getTaskModel(task),
    provider,
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

function getModelProviderName(model: string) {
  if (model.startsWith('google/gemini')) {
    return 'Gemini via OpenRouter';
  }

  if (model.startsWith('deepseek/')) {
    return 'DeepSeek via OpenRouter';
  }

  return `OpenRouter model provider (${model.split('/')[0] || 'unknown'})`;
}

function getTaskLogName(task: OpenRouterTask) {
  return task === 'vibeCheck' ? 'Vibecheck' : 'Replies';
}

function getPromptMetrics(systemPrompt: string, userPrompt: string) {
  const systemPromptChars = systemPrompt.length;
  const userPromptChars = userPrompt.length;
  const totalChars = systemPromptChars + userPromptChars;

  return {
    estimatedTokens: estimateTokens(totalChars),
    systemPromptChars,
    totalChars,
    userPromptChars,
  };
}

function getProviderRoutingLabel(provider?: OpenRouterProviderRouting) {
  if (!provider) {
    return 'openrouter-default';
  }

  if (provider.only?.length) {
    return `only:${provider.only.join(',')}`;
  }

  if (provider.sort) {
    return `sort:${provider.sort}`;
  }

  return 'custom';
}

function logOpenRouterRequest({
  attempt,
  durationMs,
  model,
  promptMetrics,
  provider,
  result,
  task,
}: {
  attempt: OpenRouterAttempt;
  durationMs?: number;
  model: string;
  promptMetrics: ReturnType<typeof getPromptMetrics>;
  provider?: OpenRouterProviderRouting;
  result: 'start' | 'success' | 'failure';
  task: OpenRouterTask;
}) {
  console.info(`[Wingr AI] ${getTaskLogName(task)} provider: ${getModelProviderName(model)}`, {
    attempt,
    durationMs,
    endpointType: 'OpenRouter chat completions',
    estimatedTokens: promptMetrics.estimatedTokens,
    model,
    providerRouting: getProviderRoutingLabel(provider),
    requestType: getRequestTypeLabel(task),
    result,
    systemPromptChars: promptMetrics.systemPromptChars,
    task,
    totalChars: promptMetrics.totalChars,
    url: OPENROUTER_URL,
    userPromptChars: promptMetrics.userPromptChars,
  });
}

function warnIfPromptExceedsBudget(task: OpenRouterTask, model: string, promptMetrics: ReturnType<typeof getPromptMetrics>) {
  const estimatedTokenBudget = getEstimatedTokenBudget(task);

  if (promptMetrics.estimatedTokens <= estimatedTokenBudget) {
    return;
  }

  console.warn('[AI Prompt Budget Warning]', {
    estimatedTokens: promptMetrics.estimatedTokens,
    model,
    requestType: getRequestTypeLabel(task),
    totalChars: promptMetrics.totalChars,
  });
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
      attempt: 'primary',
      task: requestTask,
      ...getPrimaryRequestOptions(requestTask),
    });
  } catch (primaryError) {
    console.warn('OpenRouter primary provider failed, retrying with latency routing.', primaryError);

    return callOpenRouterStructuredOnce<T>({
      apiKey,
      prompt,
      schema,
      schemaName,
      attempt: 'latencyFallback',
      task: requestTask,
      ...getLatencyFallbackRequestOptions(requestTask),
    });
  }
}

async function callOpenRouterStructuredOnce<T>({
  apiKey,
  attempt,
  model,
  prompt,
  provider,
  schema,
  schemaName,
  task,
}: {
  apiKey: string;
  attempt: OpenRouterAttempt;
  model: string;
  prompt: string;
  provider?: OpenRouterProviderRouting;
  schema: OpenRouterSchema;
  schemaName: string;
  task: OpenRouterTask;
}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getOpenRouterTimeoutMs());
  const startedAt = Date.now();
  const promptMetrics = getPromptMetrics(WINGR_SYSTEM_PROMPT, prompt);
  warnIfPromptExceedsBudget(task, model, promptMetrics);

  let response: Response | null = null;

  try {
    logOpenRouterRequest({
      attempt,
      model,
      promptMetrics,
      provider,
      result: 'start',
      task,
    });

    response = await fetch(OPENROUTER_URL, {
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: WINGR_SYSTEM_PROMPT,
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
  } catch (fetchError) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      model,
      promptMetrics,
      provider,
      result: 'failure',
      task,
    });

    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response) {
    throw new Error('OpenRouter request did not return a response.');
  }

  if (!response.ok) {
    const text = await response.text();
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      model,
      promptMetrics,
      provider,
      result: 'failure',
      task,
    });
    throw new Error(`OpenRouter request failed with ${response.status}: ${text}`);
  }

  const payload = await response.json();
  const content = extractTextContent(payload?.choices?.[0]?.message?.content);

  if (!content) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      model,
      promptMetrics,
      provider,
      result: 'failure',
      task,
    });
    throw new Error('OpenRouter returned an empty response.');
  }

  let parsedContent: T;

  try {
    parsedContent = JSON.parse(content) as T;
  } catch (parseError) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      model,
      promptMetrics,
      provider,
      result: 'failure',
      task,
    });

    throw parseError;
  }

  logOpenRouterRequest({
    attempt,
    durationMs: Date.now() - startedAt,
    model,
    promptMetrics,
    provider,
    result: 'success',
    task,
  });

  return parsedContent;
}
