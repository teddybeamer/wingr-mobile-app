const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = Deno.env.get('OPENROUTER_MODEL') ?? 'deepseek/deepseek-v3.2';

type OpenRouterSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required: readonly string[];
  additionalProperties?: boolean;
};

function getOpenRouterApiKey() {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  return apiKey;
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
}: {
  prompt: string;
  schema: OpenRouterSchema;
  schemaName: string;
}): Promise<T> {
  const apiKey = getOpenRouterApiKey();
  const response = await fetch(OPENROUTER_URL, {
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
      model: OPENROUTER_MODEL,
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
  });

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
