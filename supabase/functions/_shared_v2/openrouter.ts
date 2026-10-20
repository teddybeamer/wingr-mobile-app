import {
  AI_OUTPUT_CONTRACT,
  ConversationError,
  conversationSchema,
  parseProviderConversationResult,
  type ConversationRequest,
} from "./conversation.ts";
import { buildConversationPrompt, SYSTEM_PROMPT } from "./prompting.ts";

// Model presets. Each preset pins exactly one provider: there is no provider or
// model fallback chain, and ZDR / data_collection:deny stay on for every preset.
// Gemini is the default and the only production configuration; another preset is
// selected only by the AI_MODEL secret, and any other value falls back to Gemini.
export const GEMINI_MODEL = "google/gemini-3.8-flash";
export const DEEPSEEK_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const DEFAULT_MODEL = GEMINI_MODEL;
export const AI_TIMEOUT_MS = 25_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export type ProviderLatencyMeasurement = {
  durationMs: number;
  // Fixed configuration strings (never request or response content).
  model: string;
  outcome: "success" | "provider" | "invalid_output" | "timeout";
  outputContract: typeof AI_OUTPUT_CONTRACT;
  provider: string;
};

// Owner decision 2026-10-12 (speed priority): the default is "low". "medium" is one
// secret away (AI_REASONING_EFFORT=medium); any other value or no secret means the
// default. Only reasoning.effort changes; routing, model and contract stay pinned.
export type ReasoningEffort = "low" | "medium";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

export function parseReasoningEffort(
  value: string | null | undefined,
): ReasoningEffort {
  return value?.trim() === "medium" ? "medium" : DEFAULT_REASONING_EFFORT;
}

type ModelPreset = {
  provider: string;
  reasoning: (effort: ReasoningEffort) => { effort: string };
};
const MODEL_PRESETS = {
  [GEMINI_MODEL]: {
    provider: "google-vertex/global",
    reasoning: (effort) => ({ effort }),
  },
  // DeepSeek V4.1 Flash is not reasoning-mandatory and thinks at "high" when no
  // effort is sent, so an explicit effort is always sent. It accepts max, high,
  // low and none (no "medium"): low stays low and the optional "medium" switch
  // maps to the nearest supported level, high. Served by inference.net (fp8),
  // a ZDR endpoint that supports strict structured outputs.
  [DEEPSEEK_MODEL]: {
    provider: "inference-net/fp8",
    reasoning: (effort) => ({ effort: effort === "medium" ? "high" : "low" }),
  },
} as const satisfies Record<string, ModelPreset>;
export type ModelId = keyof typeof MODEL_PRESETS;

export function parseModel(value: string | null | undefined): ModelId {
  const requested = value?.trim();
  return requested && Object.hasOwn(MODEL_PRESETS, requested)
    ? (requested as ModelId)
    : DEFAULT_MODEL;
}

export function providerForModel(model: ModelId) {
  return MODEL_PRESETS[model].provider;
}

export function buildOpenRouterRequest(
  request: ConversationRequest,
  reasoningEffort: ReasoningEffort = DEFAULT_REASONING_EFFORT,
  model: ModelId = DEFAULT_MODEL,
) {
  const preset = MODEL_PRESETS[model];
  return {
    model,
    reasoning: preset.reasoning(reasoningEffort),
    service_tier: "default",
    provider: {
      only: [preset.provider],
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
    max_tokens: 5000,
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
    model = DEFAULT_MODEL,
    onProviderLatency,
    reasoningEffort = DEFAULT_REASONING_EFFORT,
    timeoutMs = AI_TIMEOUT_MS,
    signal,
  }: {
    fetchImpl?: typeof fetch;
    model?: ModelId;
    onProviderDispatch?: () => Promise<void>;
    onProviderLatency?: (measurement: ProviderLatencyMeasurement) => void;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (!apiKey.trim()) throw new ConversationError("provider");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const body = JSON.stringify(
    buildOpenRouterRequest(request, reasoningEffort, model),
  );
  let providerStartedAt: number | null = null;
  let providerOutcome: ProviderLatencyMeasurement["outcome"] = "provider";
  // Includes response body consumption, not just response headers.
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (controller.signal.aborted) throw new ConversationError("timeout");
    await onProviderDispatch?.();
    providerStartedAt = Date.now();
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
    const parsed = parseProviderConversationResult(result);
    providerOutcome = "success";
    return parsed;
  } catch (error) {
    if (controller.signal.aborted) {
      providerOutcome = "timeout";
      throw new ConversationError("timeout");
    }
    // Never expose upstream bodies, messages, or request content in logs/errors.
    const safeError =
      error instanceof ConversationError
        ? error
        : new ConversationError("provider");
    if (safeError.kind === "invalid_output") providerOutcome = "invalid_output";
    else if (safeError.kind === "timeout") providerOutcome = "timeout";
    else providerOutcome = "provider";
    throw safeError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (providerStartedAt !== null) {
      try {
        onProviderLatency?.({
          durationMs: Date.now() - providerStartedAt,
          model,
          outcome: providerOutcome,
          outputContract: AI_OUTPUT_CONTRACT,
          provider: providerForModel(model),
        });
      } catch {
        // Observability must never affect an AI request.
      }
    }
  }
}
