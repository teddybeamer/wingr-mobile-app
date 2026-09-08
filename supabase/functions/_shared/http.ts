import { corsHeaders } from "./cors.ts";

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders,
      ...(init?.headers ?? {}),
    },
  });
}

export function error(message: string, status = 400) {
  return json({ error: message }, { status });
}
