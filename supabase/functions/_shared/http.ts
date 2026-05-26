import { corsHeaders } from './cors.ts';

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

export function error(message: string, status = 400, details?: unknown) {
  return json(
    {
      error: message,
      ...(details === undefined ? {} : { details }),
    },
    { status },
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
