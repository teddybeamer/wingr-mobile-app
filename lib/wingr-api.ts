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

async function getBackendError(response: Response) {
  const responseText = await response.text();

  try {
    const payload = JSON.parse(responseText) as { error?: unknown };

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Fall back to the status-only error below for non-JSON responses.
  }

  return `Wingr backend request failed with ${response.status}.`;
}

function logBackendResponse(path: string, response: Response) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[Wingr flow] backend response', {
      ok: response.ok,
      path,
      status: response.status,
    });
  }
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

  logBackendResponse(path, response);

  if (!response.ok) {
    throw new Error(await getBackendError(response));
  }

  return response.json() as Promise<TResponse>;
}
