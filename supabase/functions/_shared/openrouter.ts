import {
  estimateTokens,
  getEstimatedTokenBudget,
  getRequestTypeLabel,
} from './prompt-budget.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek/deepseek-v3.2';
const DEEPINFRA_PROVIDER = 'deepinfra';
const DEFAULT_VIBE_CHECK_MODEL = 'google/gemini-2.5-flash-lite';
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20_000;
const WINGR_SYSTEM_PROMPT =
  'You are Wingr AI. Help users continue dating conversations naturally with human, emotionally intelligent, confident replies that are easy to send and keep the conversation moving. Return output that strictly matches the required JSON schema.';

type OpenRouterTask = 'reply' | 'vibeCheck';

type OpenRouterProviderRouting = {
  allow_fallbacks?: boolean;
  data_collection: 'deny';
  only?: string[];
  sort?: 'latency' | 'price' | 'throughput';
  zdr: true;
};

type OpenRouterSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties?: boolean;
};

type OpenRouterRequestOptions = {
  model: string;
  provider: OpenRouterProviderRouting;
};

type OpenRouterAttempt = 'primary' | 'latencyFallback';
type OpenRouterFailureReason = 'deadline_budget_exhausted' | 'empty_response' | 'http_status' | 'json_parse' | 'network_or_timeout';

type OpenRouterRequestInstrumentation = {
  onAttemptStart?: () => void;
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
  if (task === 'reply') {
    return {
      model: getTaskModel(task),
      provider: {
        allow_fallbacks: false,
        data_collection: 'deny',
        only: [DEEPINFRA_PROVIDER],
        zdr: true,
      },
    };
  }

  const taskProvider = getTaskProvider(task);
  const providerSlugs = taskProvider ? getProviderSlugs(taskProvider) : [];
  const routing =
    providerSlugs.length > 0
      ? { only: providerSlugs }
      : {};

  return {
    model: getTaskModel(task),
    provider: {
      data_collection: 'deny',
      zdr: true,
      ...routing,
    },
  };
}

function getLatencyFallbackRequestOptions(task: OpenRouterTask): OpenRouterRequestOptions {
  return {
    model: getTaskModel(task),
    provider: {
      data_collection: 'deny',
      sort: 'latency',
      zdr: true,
    },
  };
}

function getOpenRouterTimeoutMs() {
  const timeoutMs = Number(getEnv('OPENROUTER_TIMEOUT_MS'));

  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_OPENROUTER_TIMEOUT_MS;
}

class OpenRouterTransportError extends Error {}

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

function getProviderRoutingLabel(provider: OpenRouterProviderRouting) {
  if (provider.only?.length) {
    return `only:${provider.only.join(',')}`;
  }

  if (provider.sort) {
    return `sort:${provider.sort}`;
  }

  return 'custom';
}

function getReportedProvider(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const metadata = (payload as { openrouter_metadata?: unknown }).openrouter_metadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const availableEndpoints = (metadata as {
    endpoints?: { available?: unknown };
  }).endpoints?.available;
  if (!Array.isArray(availableEndpoints)) {
    return undefined;
  }

  const selectedEndpoint = availableEndpoints.find((endpoint) =>
    endpoint && typeof endpoint === 'object' && (endpoint as { selected?: unknown }).selected === true
  );
  const provider = selectedEndpoint && typeof selectedEndpoint === 'object'
    ? (selectedEndpoint as { provider?: unknown }).provider
    : undefined;

  return typeof provider === 'string' ? provider : undefined;
}

function logOpenRouterRequest({
  attempt,
  durationMs,
  generationId,
  model,
  promptMetrics,
  provider,
  reportedProvider,
  result,
  task,
  totalGenerationDurationMs,
  failureReason,
  httpStatus,
}: {
  attempt: OpenRouterAttempt;
  durationMs?: number;
  generationId?: string;
  model: string;
  promptMetrics: ReturnType<typeof getPromptMetrics>;
  provider: OpenRouterProviderRouting;
  reportedProvider?: string;
  result: 'start' | 'success' | 'failure' | 'skipped';
  task: OpenRouterTask;
  totalGenerationDurationMs?: number;
  failureReason?: OpenRouterFailureReason;
  httpStatus?: number;
}) {
  console.info(`[Wingr AI] ${getTaskLogName(task)} provider: ${getModelProviderName(model)}`, {
    attempt,
    durationMs,
    endpointType: 'OpenRouter chat completions',
    event: 'openrouter_request',
    estimatedTokens: promptMetrics.estimatedTokens,
    model,
    failureReason,
    generationId,
    httpStatus,
    reportedProvider,
    providerRouting: getProviderRoutingLabel(provider),
    requestType: getRequestTypeLabel(task),
    result,
    systemPromptChars: promptMetrics.systemPromptChars,
    task,
    totalChars: promptMetrics.totalChars,
    totalGenerationDurationMs,
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
  deadlineAt,
  generationId,
  instrumentation,
  maxLatencyFallbackAttemptMs,
  maxPrimaryAttemptMs,
  minLatencyFallbackWindowMs = 0,
  prompt,
  schema,
  schemaName,
  task,
}: {
  deadlineAt?: number;
  generationId?: string;
  instrumentation?: OpenRouterRequestInstrumentation;
  maxLatencyFallbackAttemptMs?: number;
  maxPrimaryAttemptMs?: number;
  minLatencyFallbackWindowMs?: number;
  prompt: string;
  schema: OpenRouterSchema;
  schemaName: string;
  task?: OpenRouterTask;
}): Promise<T> {
  const apiKey = getOpenRouterApiKey();
  const requestTask = task ?? 'reply';
  const requestStartedAt = Date.now();

  try {
    return await callOpenRouterStructuredOnce<T>({
      apiKey,
      deadlineAt,
      generationId,
      maxAttemptMs: maxPrimaryAttemptMs,
      prompt,
      schema,
      schemaName,
      attempt: 'primary',
      instrumentation,
      requestStartedAt,
      task: requestTask,
      ...getPrimaryRequestOptions(requestTask),
    });
  } catch (error) {
    if (!(error instanceof OpenRouterTransportError)) {
      throw error;
    }

    if (deadlineAt !== undefined && Date.now() + minLatencyFallbackWindowMs >= deadlineAt) {
      const fallbackOptions = getLatencyFallbackRequestOptions(requestTask);
      logOpenRouterRequest({
        attempt: 'latencyFallback',
        failureReason: 'deadline_budget_exhausted',
        generationId,
        model: fallbackOptions.model,
        promptMetrics: getPromptMetrics(WINGR_SYSTEM_PROMPT, prompt),
        provider: fallbackOptions.provider,
        reportedProvider: undefined,
        result: 'skipped',
        task: requestTask,
        totalGenerationDurationMs: Date.now() - requestStartedAt,
      });
      throw error;
    }

    // Do not log the provider error object: it can contain response data from an
    // upstream service. The retry preserves the same privacy routing guarantees.
    console.warn('OpenRouter primary provider failed; retrying with privacy-preserving latency routing.');

    return callOpenRouterStructuredOnce<T>({
      apiKey,
      deadlineAt,
      generationId,
      maxAttemptMs: maxLatencyFallbackAttemptMs,
      prompt,
      schema,
      schemaName,
      attempt: 'latencyFallback',
      instrumentation,
      requestStartedAt,
      task: requestTask,
      ...getLatencyFallbackRequestOptions(requestTask),
    });
  }
}

async function callOpenRouterStructuredOnce<T>({
  apiKey,
  attempt,
  deadlineAt,
  generationId,
  instrumentation,
  maxAttemptMs,
  model,
  prompt,
  provider,
  requestStartedAt,
  schema,
  schemaName,
  task,
}: {
  apiKey: string;
  attempt: OpenRouterAttempt;
  deadlineAt?: number;
  generationId?: string;
  instrumentation?: OpenRouterRequestInstrumentation;
  maxAttemptMs?: number;
  model: string;
  prompt: string;
  provider: OpenRouterProviderRouting;
  requestStartedAt: number;
  schema: OpenRouterSchema;
  schemaName: string;
  task: OpenRouterTask;
}): Promise<T> {
  const remainingDeadlineMs = deadlineAt === undefined
    ? undefined
    : deadlineAt - Date.now();

  if (remainingDeadlineMs !== undefined && remainingDeadlineMs <= 0) {
    throw new Error('OpenRouter request deadline exceeded.');
  }

  const controller = new AbortController();
  const timeoutMs = remainingDeadlineMs === undefined
    ? Math.min(getOpenRouterTimeoutMs(), maxAttemptMs ?? Number.POSITIVE_INFINITY)
    : Math.min(getOpenRouterTimeoutMs(), maxAttemptMs ?? Number.POSITIVE_INFINITY, remainingDeadlineMs);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const promptMetrics = getPromptMetrics(WINGR_SYSTEM_PROMPT, prompt);
  warnIfPromptExceedsBudget(task, model, promptMetrics);

  let response: Response | null = null;

  try {
    instrumentation?.onAttemptStart?.();
    logOpenRouterRequest({
      attempt,
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
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
        provider,
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
        'x-openrouter-metadata': 'enabled',
      },
      method: 'POST',
      signal: controller.signal,
    });
  } catch (fetchError) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
      result: 'failure',
      task,
      totalGenerationDurationMs: Date.now() - requestStartedAt,
      failureReason: 'network_or_timeout',
    });

    throw new OpenRouterTransportError('OpenRouter transport request failed.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response) {
    throw new Error('OpenRouter request did not return a response.');
  }

  if (!response.ok) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
      result: 'failure',
      task,
      totalGenerationDurationMs: Date.now() - requestStartedAt,
      failureReason: 'http_status',
      httpStatus: response.status,
    });
    // Do not include the upstream response body in errors or logs. Providers can
    // include request-derived content in error responses.
    throw new OpenRouterTransportError(`OpenRouter request failed with ${response.status}.`);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (parseError) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
      result: 'failure',
      task,
      totalGenerationDurationMs: Date.now() - requestStartedAt,
      failureReason: 'json_parse',
    });

    throw parseError;
  }

  const content = extractTextContent(
    (payload as { choices?: Array<{ message?: { content?: unknown } }> })
      .choices?.[0]?.message?.content,
  );

  if (!content) {
    logOpenRouterRequest({
      attempt,
      durationMs: Date.now() - startedAt,
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
      result: 'failure',
      task,
      totalGenerationDurationMs: Date.now() - requestStartedAt,
      failureReason: 'empty_response',
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
      generationId,
      model,
      promptMetrics,
      provider,
      reportedProvider: undefined,
      result: 'failure',
      task,
      totalGenerationDurationMs: Date.now() - requestStartedAt,
      failureReason: 'json_parse',
    });

    throw parseError;
  }

  logOpenRouterRequest({
    attempt,
    durationMs: Date.now() - startedAt,
    generationId,
    model,
    promptMetrics,
    provider,
    reportedProvider: getReportedProvider(payload),
    result: 'success',
    task,
    totalGenerationDurationMs: Date.now() - requestStartedAt,
  });

  return parsedContent;
}
