import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [analysisFailureCount, setAnalysisFailureCount] = useState(0);
  const generatedReplyForScreenshotUriRef = useRef<string | null>(null);
  const completeOnboarding = useCallback(() => {
    conversation.reset();
    setAnalysisFailureCount(0);
    generatedReplyForScreenshotUriRef.current = null;
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
  const stepCanContinue = isUploadStep
    ? Boolean(conversation.selectedScreenshotUri)
    : isVibeStep
      ? analysisFailureCount >= 3 ||
        (conversation.analysisStatus === "ready" &&
          conversation.repliesStatus === "ready" &&
          conversation.generatedReplies.length > 0)
      : canContinue;
  const ctaLoading =
    isVibeStep &&
    (conversation.analysisStatus === "analyzing" ||
      conversation.repliesStatus === "generating");

  const analyzeScreenshotForOnboarding = useCallback(
    async (screenshotUri?: string) => {
      const result = await conversation.analyzeScreenshot(screenshotUri);

      if (result === "error") {
        setAnalysisFailureCount((count) => count + 1);
      } else if (result === "ready") {
        setAnalysisFailureCount(0);
      }

      return result;
    },
    [conversation],
  );

  useEffect(() => {
    const screenshotUri = conversation.selectedScreenshotUri?.trim();

    if (
      !isVibeStep ||
      !screenshotUri ||
      conversation.analysisStatus !== "ready" ||
      conversation.repliesStatus !== "idle" ||
      conversation.generatedReplies.length > 0 ||
      generatedReplyForScreenshotUriRef.current === screenshotUri
    ) {
      return;
    }

    generatedReplyForScreenshotUriRef.current = screenshotUri;
    void conversation.generateRepliesForSelectedTone();
  }, [
    conversation.analysisStatus,
    conversation.generatedReplies.length,
    conversation.generateRepliesForSelectedTone,
    conversation.repliesStatus,
    conversation.selectedScreenshotUri,
    isVibeStep,
  ]);

  const handlePrimaryAction = async () => {
    if (!stepCanContinue || ctaLoading) {
      return;
    }

    if (isUploadStep) {
      goNext();
      await analyzeScreenshotForOnboarding();
      return;
    }

    if (isVibeStep) {
      goNext();
      return;
    }

    goNext();
  };

  const handleScreenshotSelected = async (screenshotUri: string) => {
    setAnalysisFailureCount(0);
    generatedReplyForScreenshotUriRef.current = null;
    goNext(true);
    await analyzeScreenshotForOnboarding(screenshotUri);
  };

  const retryScreenshotAnalysis = async () => {
    await analyzeScreenshotForOnboarding();
  };

  const analyzeReplacementScreenshot = async (screenshotUri: string) => {
    setAnalysisFailureCount(0);
    generatedReplyForScreenshotUriRef.current = null;
    await analyzeScreenshotForOnboarding(screenshotUri);
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
      analysisFailureCount={analysisFailureCount}
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
      onReplacementScreenshotSelected={analyzeReplacementScreenshot}
      onRetryScreenshotAnalysis={retryScreenshotAnalysis}
      onScreenshotSelected={handleScreenshotSelected}
      onSelectChoice={selectChoice}
      onSkip={skip}
      selectedChoiceId={selectedChoiceId}
      totalSteps={totalSteps}
    />
  );
}
