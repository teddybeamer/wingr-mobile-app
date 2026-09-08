import {
  ConversationError,
  conversationSchema,
  parseConversationResult,
  type ConversationRequest,
} from "./conversation.ts";
import { buildConversationPrompt, SYSTEM_PROMPT } from "./prompting.ts";

// The only production model configuration. No provider/model fallback chain.
export const GEMINI_MODEL = "google/gemini-3.8-flash";
export const AI_TIMEOUT_MS = 25_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function buildOpenRouterRequest(request: ConversationRequest) {
  return {
    model: GEMINI_MODEL,
    reasoning: { effort: "medium" },
    service_tier: "default",
    provider: {
      only: ["google-vertex/global"],
      zdr: true,
      data_collection: "deny",
      allow_fallbacks: false,
      require_parameters: true,
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: buildConversationPrompt(request) },
          { type: "image_url", image_url: { url: request.screenshot } },
        ],
      },
    ],
    max_tokens: 8000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "wingr_conversation",
        strict: true,
        schema: conversationSchema,
      },
    },
  };
}

// Classify only fixed configuration-error signatures. Never return or log the
// provider message, metadata, or raw response, which may contain private input.
export function getProviderErrorReason(payload: unknown) {
  const error = (
    payload as {
      error?: { message?: unknown; metadata?: { raw?: unknown } };
    } | null
  )?.error;
  const message = typeof error?.message === "string" ? error.message : "";
  const raw =
    typeof error?.metadata?.raw === "string" ? error.metadata.raw : "";
  const details = `${message} ${raw}`;
  if (
    /not a valid model|invalid model (?:id|identifier)|model[^.]*not found/i.test(
      details,
    )
  )
    return "model_unavailable";
  if (/(?:user|user_id)[^.]{0,60}(?:required|must be provided)/i.test(details))
    return "user_required";
  if (
    /invalid[^.]*schema|schema[^.]*(?:invalid|unsupported|too complex)|unknown name[^.]*(?:additionalProperties|anyOf|maxItems|minLength)/i.test(
      details,
    )
  )
    return "schema_rejected";
  if (
    /invalid image|unable to (?:decode|process) (?:the )?image|unsupported image|image[^.]*invalid/i.test(
      details,
    )
  )
    return "image_rejected";
  if (
    /no endpoints found|no available providers|no endpoints[^.]*data policy/i.test(
      details,
    )
  )
    return "routing_unavailable";
  return undefined;
}

export async function analyzeWithGemini(
  request: ConversationRequest,
  apiKey: string,
  {
    fetchImpl = fetch,
    onProviderDispatch,
    timeoutMs = AI_TIMEOUT_MS,
    signal,
  }: {
    fetchImpl?: typeof fetch;
    onProviderDispatch?: () => Promise<void>;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (!apiKey.trim()) throw new ConversationError("provider");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const body = JSON.stringify(buildOpenRouterRequest(request));
  // Includes response body consumption, not just response headers.
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted) throw new ConversationError("timeout");
    await onProviderDispatch?.();
    const response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body,
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new ConversationError(
        "provider",
        response.status,
        getProviderErrorReason(failure),
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ConversationError("invalid_output");
    }
    if (payload?.error)
      throw new ConversationError(
        "provider",
        payload.error.code,
        getProviderErrorReason(payload),
      );
    const choice = payload?.choices?.[0];
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice?.message?.content !== "string" ||
      choice.message.refusal
    ) {
      throw new ConversationError("invalid_output");
    }
    let result;
    try {
      result = JSON.parse(choice.message.content);
    } catch {
      throw new ConversationError("invalid_output");
    }
    return parseConversationResult(result);
  } catch (error) {
    if (controller.signal.aborted) throw new ConversationError("timeout");
    // Never expose upstream bodies, messages, or request content in logs/errors.
    throw error instanceof ConversationError
      ? error
      : new ConversationError("provider");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
