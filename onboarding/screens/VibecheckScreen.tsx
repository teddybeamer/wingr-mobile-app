import {
  InlineErrorCard,
  RepliesContent,
  VibeCheckCard,
} from "../../components/conversation/ConversationContent";
import { ReplyLoadingScreen } from "../../components/conversation/ReplyLoadingScreen";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

const MAX_SCREENSHOT_ANALYSIS_FAILURES = 3;

export function VibecheckScreen(props: OnboardingScreenProps) {
  const {
    analysisFailureCount = 0,
    conversation,
    onReplacementScreenshotSelected,
    onRetryScreenshotAnalysis,
  } = props;
  const canSkipResults =
    analysisFailureCount >= MAX_SCREENSHOT_ANALYSIS_FAILURES;

  const chooseAnotherScreenshot = async () => {
    const screenshotUri = await conversation.pickScreenshot();

    if (screenshotUri) {
      await onReplacementScreenshotSelected?.(screenshotUri);
    }
  };

  if (conversation.analysisStatus === "analyzing") {
    return <ReplyLoadingScreen />;
  }

  return (
    <OnboardingScreenScaffold {...props} middleContentScrollable>
      {conversation.analysisStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            if (canSkipResults) {
              void chooseAnotherScreenshot();
              return;
            }

            void onRetryScreenshotAnalysis?.();
          }}
          onSecondaryAction={
            canSkipResults
              ? undefined
              : () => {
                  void chooseAnotherScreenshot();
                }
          }
          primaryLabel={canSkipResults ? "Choose another screenshot" : "Retry"}
          secondaryLabel={
            canSkipResults ? undefined : "Choose another screenshot"
          }
        />
      ) : null}

      {conversation.analysisStatus === "ready" && conversation.vibeCheck ? (
        <>
          <VibeCheckCard
            presentation="inlineExpandable"
            vibeCheck={conversation.vibeCheck}
          />
          <RepliesContent
            isGenerating={conversation.repliesStatus === "generating"}
            maxReplies={1}
            onRefreshReplies={conversation.refreshReplies}
            onToneChange={conversation.changeTone}
            presentation="mainFeed"
            replies={conversation.generatedReplies}
            selectedTone={conversation.selectedTone}
            showControls={false}
            showTypingIndicator
          />
        </>
      ) : null}

      {conversation.repliesStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            void conversation.generateRepliesForSelectedTone();
          }}
          primaryLabel="Retry"
        />
      ) : null}
    </OnboardingScreenScaffold>
  );
}
