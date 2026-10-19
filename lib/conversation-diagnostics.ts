import type {
  ConversationFlowError,
  ConversationFlowName,
} from "../hooks/useConversationFlow";

export function buildConversationFailureProperties({
  durationMs,
  error,
  flow,
  outputContract,
}: {
  durationMs: number;
  error: ConversationFlowError;
  flow: ConversationFlowName;
  outputContract: string;
}) {
  return {
    duration_ms: durationMs,
    ...(error.errorCode ? { error_code: error.errorCode } : {}),
    ...(error.failureReason ? { failure_reason: error.failureReason } : {}),
    ...(error.httpStatus ? { http_status: error.httpStatus } : {}),
    flow,
    output_contract: outputContract,
  };
}

export function captureSafely<T>(
  capture: (event: string, properties?: T) => unknown,
  event: string,
  properties?: T,
) {
  try {
    capture(event, properties);
  } catch {
    // Analytics is optional and must not affect application behavior.
  }
}
