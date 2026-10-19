import type { ConversationFlowError } from "../hooks/useConversationFlow";
import type { UnusableScreenshotReason } from "../supabase/functions/_shared_v2/conversation";

export type ScreenshotErrorPresentation = {
  button: "Choose another screenshot";
  message: string;
  title: string;
};

const CHOOSE_ANOTHER = "Choose another screenshot" as const;

export function getScreenshotErrorPresentation(
  reason: UnusableScreenshotReason,
): ScreenshotErrorPresentation {
  switch (reason) {
    case "unreadable_image":
      return {
        button: CHOOSE_ANOTHER,
        message:
          "The messages aren’t clear enough to read. Try a sharper screenshot.",
        title: "Can’t read screenshot",
      };
    case "no_conversation":
      return {
        button: CHOOSE_ANOTHER,
        message:
          "We couldn’t find readable chat messages in this image. Try a screenshot showing your conversation.",
        title: "No readable conversation found",
      };
    case "ownership_unclear":
    case "no_replyable_message":
      return {
        button: CHOOSE_ANOTHER,
        message:
          "Try a screenshot that shows the latest messages in your conversation.",
        title: "Need a bit more context",
      };
    case "unknown":
      return {
        button: CHOOSE_ANOTHER,
        message: "We couldn’t read that conversation. Try another screenshot.",
        title: "Couldn’t analyze screenshot",
      };
  }
}

export function getSemanticScreenshotError(
  error: ConversationFlowError | null | undefined,
) {
  if (error?.errorCode !== "unusable_screenshot") return null;
  return {
    id: error.id,
    presentation: getScreenshotErrorPresentation(
      error.failureReason ?? "unknown",
    ),
  };
}

export function createDeferredScreenshotPicker(
  chooseScreenshot: () => void | Promise<void>,
) {
  let pending = false;
  return {
    cancel() {
      pending = false;
    },
    request() {
      pending = true;
    },
    async sheetClosed() {
      if (!pending) return;
      pending = false;
      await chooseScreenshot();
    },
  };
}

export async function chooseSemanticReplacement({
  onSelected,
  pickScreenshot,
}: {
  onSelected: (uri: string) => void | Promise<void>;
  pickScreenshot: (options: { preserveTone: true }) => Promise<string | null>;
}) {
  const uri = await pickScreenshot({ preserveTone: true });
  if (!uri) return false;
  await onSelected(uri);
  return true;
}
