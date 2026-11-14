import {
  MAX_PREVIOUS_OPENERS,
  parseOpenerRequest,
  parseOpenerResult,
  type OpenerRequest,
} from "../supabase/functions/_shared_v2/opener";
import type { ReplyTone, StartersResult, SuggestedReply } from "../types/wingr";
import { postJsonToWingrBackend } from "./wingr-api";

export const AI_OPENER_PATH = "/ai-opener";

function toCards(
  openers: { text: string; tone: ReplyTone }[],
  requestId: number,
): SuggestedReply[] {
  return openers.map((opener, index) => ({
    id: `opener-${requestId}-${index}`,
    text: opener.text,
    tone: opener.tone,
  }));
}

// The last openers shown, so the next one takes a different angle.
export function selectPreviousOpeners(openers: readonly SuggestedReply[]) {
  return openers.slice(-MAX_PREVIOUS_OPENERS).map((opener) => opener.text);
}

async function requestOpeners(
  request: Omit<OpenerRequest, "screenshot"> & { screenshotUri: string },
  signal?: AbortSignal,
) {
  const { readScreenshot } = await import("./screenshot");
  const screenshot = await readScreenshot(request.screenshotUri);
  if (signal?.aborted) throw new Error("Opener request cancelled.");
  // The same strict check the server applies, before anything is sent.
  const body = parseOpenerRequest({
    kind: request.kind,
    screenshot,
    ...(request.kind === "another"
      ? {
          selectedTone: request.selectedTone,
          ...(request.previousOpeners?.length
            ? { previousOpeners: request.previousOpeners }
            : {}),
        }
      : {}),
  });
  const result = await postJsonToWingrBackend<unknown>(
    AI_OPENER_PATH,
    body,
    signal,
  );
  return parseOpenerResult(result, body);
}

// The first read of a profile: The Angle and one opener per tone.
export async function requestStarters({
  requestId,
  screenshotUri,
  signal,
}: {
  requestId: number;
  screenshotUri: string;
  signal?: AbortSignal;
}): Promise<StartersResult> {
  const result = await requestOpeners(
    { kind: "starters", screenshotUri },
    signal,
  );
  // parseOpenerResult guarantees a read for "starters".
  return {
    angle: result.angle!,
    openers: toCards(result.openers, requestId),
  };
}

// One more opener in the chosen tone.
export async function requestAnotherOpener({
  previousOpeners,
  requestId,
  screenshotUri,
  selectedTone,
  signal,
}: {
  previousOpeners: string[];
  requestId: number;
  screenshotUri: string;
  selectedTone: ReplyTone;
  signal?: AbortSignal;
}): Promise<SuggestedReply> {
  const result = await requestOpeners(
    { kind: "another", previousOpeners, screenshotUri, selectedTone },
    signal,
  );
  return toCards(result.openers, requestId)[0];
}
