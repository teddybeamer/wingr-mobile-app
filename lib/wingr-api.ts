declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const WINGR_API_BASE_URL =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_WINGR_API_BASE_URL ?? '' : '';

function getBackendUrl(path: string) {
  const baseUrl = WINGR_API_BASE_URL.trim().replace(/\/$/, '');

  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function hasWingrBackend() {
  return getBackendUrl('/') !== null;
}

export async function postJsonToWingrBackend<TResponse>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  const url = getBackendUrl(path);

  if (!url) {
    throw new Error('Wingr backend URL is not configured.');
  }

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Wingr backend request failed with ${response.status}.`);
  }

  return response.json() as Promise<TResponse>;
}

export async function postFormToWingrBackend<TResponse>(
  path: string,
  body: FormData,
): Promise<TResponse> {
  const url = getBackendUrl(path);

  if (!url) {
    throw new Error('Wingr backend URL is not configured.');
  }

  const response = await fetch(url, {
    body,
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Wingr backend request failed with ${response.status}.`);
  }

  return response.json() as Promise<TResponse>;
}
