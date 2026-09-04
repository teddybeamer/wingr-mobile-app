export type ContentFreeDiagnosticMetadata = Record<string, unknown>;

export type ContentFreeDiagnosticTrace = (
  stage: string,
  metadata?: ContentFreeDiagnosticMetadata,
) => void;

function isForbiddenDiagnosticKey(key: string) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();

  return (
    normalized.includes("text") ||
    normalized.includes("transcript") ||
    normalized.includes("uri") ||
    normalized.includes("url") ||
    normalized.includes("color") ||
    normalized.includes("colour") ||
    normalized.includes("requestbody") ||
    normalized.includes("responsebody") ||
    normalized.includes("content") ||
    normalized.includes("name") ||
    ["blue", "green", "pixel", "pixeldata", "pixels", "red", "rgb", "rgba"].includes(
      normalized,
    )
  );
}

function isExplicitlySafeDiagnosticField(key: string, value: unknown) {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();

  return (
    normalized === "contextdraw" &&
    (value === undefined ||
      (typeof value === "number" && Number.isFinite(value)))
  );
}

export function getMonotonicTimeMs() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

export function getDiagnosticDurationMs(startedAt: number) {
  return Number(Math.max(0, getMonotonicTimeMs() - startedAt).toFixed(3));
}

export function isContentFreeDiagnosticPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(isContentFreeDiagnosticPayload);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).every(
      ([key, nestedValue]) =>
        (!isForbiddenDiagnosticKey(key) ||
          isExplicitlySafeDiagnosticField(key, nestedValue)) &&
        isContentFreeDiagnosticPayload(nestedValue),
    );
  }

  return (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

export function createContentFreeDiagnosticTrace({
  label,
  runId,
}: {
  label: string;
  runId: string;
}): ContentFreeDiagnosticTrace {
  return (stage, metadata = {}) => {
    if (typeof __DEV__ === "undefined" || !__DEV__) {
      return;
    }

    const payload = { ...metadata, runId, stage };

    if (!isContentFreeDiagnosticPayload(payload)) {
      console.warn(`${label} blocked unsafe diagnostic payload`, {
        runId,
        stage,
      });
      return;
    }

    console.info(label, JSON.stringify(payload));
  };
}

export function startPendingStageDiagnostics({
  stage,
  trace,
}: {
  stage: string;
  trace: ContentFreeDiagnosticTrace;
}) {
  if (typeof __DEV__ === "undefined" || !__DEV__) {
    return () => undefined;
  }

  const startedAt = getMonotonicTimeMs();
  const timers = [5_000, 15_000].map((pendingAfterMs) =>
    setTimeout(() => {
      trace(`${stage}.pending`, {
        durationMs: getDiagnosticDurationMs(startedAt),
        pendingAfterMs,
      });
    }, pendingAfterMs),
  );

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}

export function startContentFreeDiagnosticStage({
  metadata,
  stage,
  trace,
}: {
  metadata?: ContentFreeDiagnosticMetadata;
  stage: string;
  trace: ContentFreeDiagnosticTrace;
}) {
  const startedAt = getMonotonicTimeMs();
  const stopPendingDiagnostics = startPendingStageDiagnostics({ stage, trace });

  trace(`${stage}.started`, metadata);

  return {
    complete(completionMetadata?: ContentFreeDiagnosticMetadata) {
      stopPendingDiagnostics();
      trace(`${stage}.complete`, {
        durationMs: getDiagnosticDurationMs(startedAt),
        ...completionMetadata,
      });
    },
    fail(failureMetadata?: ContentFreeDiagnosticMetadata) {
      stopPendingDiagnostics();
      trace(`${stage}.failed`, {
        durationMs: getDiagnosticDurationMs(startedAt),
        ...failureMetadata,
      });
    },
  };
}
