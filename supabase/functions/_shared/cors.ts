export const corsHeaders = {
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*',
};

export function handleCors(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
      status: 200,
    });
  }

  return null;
}
