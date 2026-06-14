import {
  AnalyzingContent,
  InlineErrorCard,
  VibeCheckCard,
} from "../../components/conversation/ConversationContent";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

export function VibecheckScreen(props: OnboardingScreenProps) {
  const { conversation, onBack } = props;

  const chooseAnotherScreenshot = async () => {
    onBack();
    await conversation.pickScreenshot();
  };

  return (
    <OnboardingScreenScaffold {...props}>
      {conversation.analysisStatus === "analyzing" ? (
        <AnalyzingContent
          selectedScreenshotUri={conversation.selectedScreenshotUri}
        />
      ) : null}

      {conversation.analysisStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            void conversation.analyzeScreenshot();
          }}
          onSecondaryAction={() => {
            void chooseAnotherScreenshot();
          }}
          primaryLabel="Retry"
          secondaryLabel="Choose another screenshot"
        />
      ) : null}

      {conversation.analysisStatus === "ready" && conversation.vibeCheck ? (
        <VibeCheckCard vibeCheck={conversation.vibeCheck} />
      ) : null}
    </OnboardingScreenScaffold>
  );
}
