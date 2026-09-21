import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { posthog } from "../lib/posthog";
import { markOnboardingReplyDisplayed } from "../lib/onboarding-progress";
import {
  recoverOnboardingReplyUsed,
  resolveOnboardingResumeStep,
} from "../lib/onboarding-recovery";
import { useConversationFlow } from "../hooks/useConversationFlow";
import { ChangeScreen } from "./screens/ChangeScreen";
import { PaywallScreen } from "./screens/PaywallScreen";
import { ProblemScreen } from "./screens/ProblemScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { RatingScreen } from "./screens/RatingScreen";
import { RepliesScreen } from "./screens/RepliesScreen";
import { TestimonialsScreen } from "./screens/TestimonialsScreen";
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
  initialStepId?: OnboardingStepId;
  moreVisible?: boolean;
  onComplete: () => void | Promise<void>;
  onMore?: () => void;
  userId: string;
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
  testimonials: TestimonialsScreen,
  uploadScreenshot: UploadScreenShotScreen,
  vibecheck: VibecheckScreen,
  welcome: WelcomeScreen,
  wouldYouSend: WouldYouSendScreen,
};

export function OnboardingFlow({
  initialStepId,
  moreVisible,
  onComplete,
  onMore,
  userId,
}: OnboardingFlowProps) {
  const [restoredInitialStep, setRestoredInitialStep] = useState<{
    loaded: boolean;
    step?: OnboardingStepId;
  }>({ loaded: false });

  useEffect(() => {
    let mounted = true;
    void resolveOnboardingResumeStep({ initialStepId, userId })
      .then((step) => {
        if (mounted) setRestoredInitialStep({ loaded: true, step });
      })
      .catch(() => {
        if (mounted) setRestoredInitialStep({ loaded: true });
      });
    return () => {
      mounted = false;
    };
  }, [initialStepId, userId]);

  if (!restoredInitialStep.loaded) return null;

  return (
    <OnboardingFlowContent
      initialStepId={restoredInitialStep.step}
      moreVisible={moreVisible}
      onComplete={onComplete}
      onMore={onMore}
      userId={userId}
    />
  );
}

function OnboardingFlowContent({
  initialStepId,
  moreVisible,
  onComplete,
  onMore,
  userId,
}: OnboardingFlowProps & { initialStepId?: OnboardingStepId }) {
  const conversation = useConversationFlow();
  const [analysisFailureCount, setAnalysisFailureCount] = useState(0);
  const completeOnboarding = useCallback(async () => {
    conversation.reset();
    setAnalysisFailureCount(0);
    posthog.capture("onboarding_completed");
    await onComplete();
  }, [conversation, onComplete]);
  const {
    canGoBack,
    canContinue,
    currentIndex,
    currentStep,
    goBack,
    goToStep,
    goNext,
    isLastStep,
    selectedChoiceId,
    selectChoice,
    skip,
    totalSteps,
  } = useOnboardingFlow(completeOnboarding, initialStepId);
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
      const result =
        await conversation.analyzeOnboardingScreenshot(screenshotUri);

      if (typeof result === "object" && result.status === "error") {
        const recoveryStep = await recoverOnboardingReplyUsed({
          errorCode: result.error.code,
          userId,
        });
        if (recoveryStep) {
          setAnalysisFailureCount(0);
          goToStep(recoveryStep, { resetHistory: true });
          return "recovered" as const;
        }
        setAnalysisFailureCount((count) => count + 1);
      } else if (result === "ready") {
        setAnalysisFailureCount(0);
        try {
          await markOnboardingReplyDisplayed(userId);
        } catch {
          // The reply remains usable even if local resume progress cannot be saved.
        }
      }

      return result;
    },
    [conversation, goToStep, userId],
  );

  const handlePrimaryAction = async () => {
    if (!stepCanContinue || ctaLoading) {
      return;
    }

    posthog.capture("onboarding_step_advanced", {
      step_id: currentStep.id,
      step_index: currentIndex,
      total_steps: totalSteps,
    });

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
    goNext(true);
    const result = await analyzeScreenshotForOnboarding(screenshotUri);

    if (typeof result === "object" && result.status === "error") {
      if (result.error.code === "onboarding_device_reply_used") return;
      Alert.alert("Could not read screenshot", result.error.message);
      goBack();
    }
  };

  const retryScreenshotAnalysis = async () => {
    await analyzeScreenshotForOnboarding();
  };

  const analyzeReplacementScreenshot = async (screenshotUri: string) => {
    setAnalysisFailureCount(0);
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
      moreVisible={moreVisible}
      onBack={goBack}
      onComplete={completeOnboarding}
      onDevicePreviewUsed={() => {
        setAnalysisFailureCount(0);
        goToStep("paywall", { resetHistory: true });
      }}
      onMore={onMore}
      onNext={goNext}
      onPrimaryAction={handlePrimaryAction}
      onReplacementScreenshotSelected={analyzeReplacementScreenshot}
      onRetryScreenshotAnalysis={retryScreenshotAnalysis}
      onScreenshotSelected={handleScreenshotSelected}
      onSelectChoice={selectChoice}
      onSkip={() => {
        if (isUploadStep) {
          goToStep("testimonials");
          return;
        }
        skip();
      }}
      selectedChoiceId={selectedChoiceId}
      totalSteps={totalSteps}
    />
  );
}
