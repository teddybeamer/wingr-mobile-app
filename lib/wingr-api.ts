declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const WINGR_API_BASE_URL =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_WINGR_API_BASE_URL ?? '' : '';

export type WingrBackendDiagnostics = {
  correlationId?: string;
  operation?: 'reply-generation' | 'vibe-check';
  requestId?: number;
};

let backendRequestSequence = 0;

function isDevelopmentBuild() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function monotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMilliseconds(startedAt: number) {
  return Math.round(monotonicNow() - startedAt);
}

function logBackendDiagnostic(stage: string, metadata: Record<string, unknown>) {
  if (isDevelopmentBuild()) {
    console.info(`[Wingr backend] ${stage}`, metadata);
  }
}

function startPendingBackendDiagnostics(
  startedAt: number,
  metadata: Record<string, unknown>,
) {
  if (!isDevelopmentBuild()) {
    return () => {};
  }

  const timers = [5_000, 15_000].map((pendingThresholdMs) =>
    setTimeout(() => {
      logBackendDiagnostic('stage still pending', {
        ...metadata,
        durationMs: elapsedMilliseconds(startedAt),
        pendingThresholdMs,
        stage: 'backend-request',
      });
    }, pendingThresholdMs),
  );

  return () => {
    timers.forEach((timer) => clearTimeout(timer));
  };
}

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

function logBackendResponse(
  path: string,
  response: Response,
  metadata?: Record<string, unknown>,
) {
  if (isDevelopmentBuild()) {
    console.info('[Wingr flow] backend response', {
      ok: response.ok,
      path,
      status: response.status,
      ...metadata,
    });
  }
}

export function hasWingrBackend() {
  return getBackendUrl('/') !== null;
}

export async function postJsonToWingrBackend<TResponse>(
  path: string,
  body: unknown,
  diagnostics?: WingrBackendDiagnostics,
): Promise<TResponse> {
  const url = getBackendUrl(path);

  if (!url) {
    throw new Error('Wingr backend URL is not configured.');
  }

  backendRequestSequence += 1;
  const backendRequestId = backendRequestSequence;
  const startedAt = monotonicNow();
  const diagnosticMetadata = {
    backendRequestId,
    correlationId: diagnostics?.correlationId,
    operation: diagnostics?.operation,
    path,
    requestId: diagnostics?.requestId,
  };
  let responseStatus: number | undefined;
  const stopPendingDiagnostics = startPendingBackendDiagnostics(
    startedAt,
    diagnosticMetadata,
  );

  logBackendDiagnostic('request started', diagnosticMetadata);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    responseStatus = response.status;
    logBackendResponse(path, response, {
      backendRequestId,
      correlationId: diagnostics?.correlationId,
      durationMs: elapsedMilliseconds(startedAt),
      operation: diagnostics?.operation,
      requestId: diagnostics?.requestId,
    });

    if (!response.ok) {
      throw new Error(await getBackendError(response));
    }

    const responseBody = (await response.json()) as TResponse;

    logBackendDiagnostic('request completed', {
      ...diagnosticMetadata,
      durationMs: elapsedMilliseconds(startedAt),
      status: response.status,
    });

    return responseBody;
  } catch (error) {
    logBackendDiagnostic('request failed', {
      ...diagnosticMetadata,
      durationMs: elapsedMilliseconds(startedAt),
      errorType: error instanceof Error ? error.name : 'unknown',
      phase: responseStatus === undefined ? 'fetch' : 'response',
      status: responseStatus,
    });

    throw error;
  } finally {
    stopPendingDiagnostics();
  }
}
