import type { ReactElement } from "react";
import { useCallback, useEffect } from "react";
import { useConversationFlow } from "../hooks/useConversationFlow";
import { ChangeScreen } from "./screens/ChangeScreen";
import { PaywallScreen } from "./screens/PaywallScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ProblemScreen } from "./screens/ProblemScreen";
import { RatingScreen } from "./screens/RatingScreen";
import { RepliesScreen } from "./screens/RepliesScreen";
import { UploadScreenShotScreen } from "./screens/UploadScreenShotScreen";
import { VibecheckScreen } from "./screens/VibecheckScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { WouldYouSendScreen } from "./screens/WouldYouSendScreen";
import { useOnboardingFlow } from "./hooks/useOnboardingFlow";
import type {
  OnboardingScreenProps,
  OnboardingStepId,
} from "./types/onboarding";

type OnboardingFlowProps = {
  onComplete: () => void;
};

const screenMap: Record<
  OnboardingStepId,
  (props: OnboardingScreenProps) => ReactElement
> = {
  change: ChangeScreen,
  paywall: PaywallScreen,
  privacy: PrivacyScreen,
  problem: ProblemScreen,
  rating: RatingScreen,
  replies: RepliesScreen,
  uploadScreenshot: UploadScreenShotScreen,
  vibecheck: VibecheckScreen,
  welcome: WelcomeScreen,
  wouldYouSend: WouldYouSendScreen,
};

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const conversation = useConversationFlow({
    speakerPolicy: "continueWithoutAttribution",
  });
  const completeOnboarding = useCallback(() => {
    conversation.reset();
    onComplete();
  }, [conversation, onComplete]);
  const {
    canGoBack,
    canContinue,
    currentIndex,
    currentStep,
    goBack,
    goNext,
    isLastStep,
    selectedChoiceId,
    selectChoice,
    skip,
    totalSteps,
  } = useOnboardingFlow(completeOnboarding);
  const ScreenComponent = screenMap[currentStep.id];
  const isUploadStep = currentStep.id === "uploadScreenshot";
  const isVibeStep = currentStep.id === "vibecheck";
  const isRepliesStep = currentStep.id === "replies";
  const stepCanContinue = isUploadStep
    ? Boolean(conversation.selectedScreenshotUri)
    : isVibeStep
      ? conversation.analysisStatus === "ready" &&
        Boolean(conversation.vibeCheck)
      : isRepliesStep
        ? conversation.generatedReplies.length > 0
        : canContinue;
  const ctaLoading = isVibeStep && conversation.repliesStatus === "generating";

  const handlePrimaryAction = async () => {
    if (!stepCanContinue || ctaLoading) {
      return;
    }

    if (isUploadStep) {
      goNext();
      await conversation.analyzeScreenshot();
      return;
    }

    if (isVibeStep) {
      const generated = await conversation.generateRepliesForSelectedTone();

      if (generated) {
        goNext();
      }
      return;
    }

    goNext();
  };

  console.log("[Wingr boot] OnboardingFlow render", {
    currentIndex,
    currentStepId: currentStep.id,
    totalSteps,
  });

  useEffect(() => {
    console.log("[Wingr boot] OnboardingFlow mounted");
  }, []);

  return (
    <ScreenComponent
      canGoBack={canGoBack}
      canContinue={stepCanContinue}
      content={currentStep.content}
      conversation={conversation}
      ctaDisabled={!stepCanContinue}
      ctaLoading={ctaLoading}
      currentIndex={currentIndex}
      isLastStep={isLastStep}
      onBack={goBack}
      onComplete={completeOnboarding}
      onNext={goNext}
      onPrimaryAction={handlePrimaryAction}
      onSelectChoice={selectChoice}
      onSkip={skip}
      selectedChoiceId={selectedChoiceId}
      totalSteps={totalSteps}
    />
  );
}
