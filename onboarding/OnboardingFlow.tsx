import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useAiConsent } from "../components/AiConsentProvider";
import { posthog } from "../lib/posthog";
import {
  getOnboardingAnalysisFailureAlert,
  isOnboardingDevicePreviewUsed,
  ONBOARDING_DEVICE_PREVIEW_USED_ALERT,
} from "../lib/onboarding-analysis-error";
import { markOnboardingReplyDisplayed } from "../lib/onboarding-progress";
import {
  recoverOnboardingReplyUsed,
  resolveOnboardingResumeStep,
} from "../lib/onboarding-recovery";
import { useConversationFlow } from "../hooks/useConversationFlow";
import { ChangeScreen } from "./screens/ChangeScreen";
import { PaywallScreen } from "./screens/PaywallScreen";
import { ProblemScreen } from "./screens/ProblemScreen";
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
import { ScreenshotErrorPopup } from "../components/conversation/ScreenshotErrorPopup";
import { chooseSemanticReplacement } from "../lib/screenshot-analysis-error";

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
  problem: ProblemScreen,
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
  const conversation = useConversationFlow("onboarding");
  const { ensureConsent, invalidate: invalidateAiConsent } = useAiConsent();
  const [analysisFailureCount, setAnalysisFailureCount] = useState(0);
  useEffect(() => {
    if (conversation.error?.kind === "permission")
      Alert.alert("Photo access needed", conversation.error.message);
  }, [conversation.error?.id]);
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
      let result =
        await conversation.analyzeOnboardingScreenshot(screenshotUri);

      // The server is the authority on consent. If it refuses (the choice was
      // withdrawn, or the saved answer was stale), ask again instead of failing;
      // the refusal happens before anything is sent or the free reply is used.
      if (
        typeof result === "object" &&
        result.status === "error" &&
        result.error.errorCode === "ai_consent_required"
      ) {
        await invalidateAiConsent();
        conversation.clearError();
        if ((await ensureConsent()) !== "granted") {
          setAnalysisFailureCount(0);
          goToStep("testimonials", { replaceCurrent: true });
          return "declined" as const;
        }
        result = await conversation.analyzeOnboardingScreenshot(screenshotUri);
      }

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
    [conversation, ensureConsent, goToStep, invalidateAiConsent, userId],
  );

  // True when AI may be used. When consent is missing this shows the consent
  // popup (once per tap). "No, thanks" leaves the user on the same screen with
  // nothing recorded or sent, and the popup comes back the next time they tap
  // Choose Screenshot. When the choice cannot be checked the user also stays
  // where they are and can try again.
  const consentGranted = async () => {
    const consent = await ensureConsent();
    if (consent === "granted") return true;
    if (consent === "unavailable") {
      Alert.alert(
        "Couldn’t check your AI sharing choice",
        "Please check your connection and try again.",
      );
    }
    return false;
  };

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
      if (!(await consentGranted())) return;
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
    if (!(await consentGranted())) return;
    setAnalysisFailureCount(0);
    goNext(true);
    const result = await analyzeScreenshotForOnboarding(screenshotUri);

    if (typeof result === "object" && result.status === "error") {
      if (isOnboardingDevicePreviewUsed(result.error)) {
        Alert.alert(
          ONBOARDING_DEVICE_PREVIEW_USED_ALERT.title,
          ONBOARDING_DEVICE_PREVIEW_USED_ALERT.message,
          [
            {
              text: ONBOARDING_DEVICE_PREVIEW_USED_ALERT.button,
              onPress: handleDevicePreviewUsed,
            },
          ],
        );
        return;
      }
      if (result.error.errorCode === "unusable_screenshot") return;
      const alert = getOnboardingAnalysisFailureAlert(result.error);
      Alert.alert(alert.title, alert.message);
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

  const chooseReplacementFromSemanticError = async () => {
    await chooseSemanticReplacement({
      pickScreenshot: conversation.pickScreenshot,
      onSelected: analyzeReplacementScreenshot,
    });
  };

  const handleDevicePreviewUsed = () => {
    setAnalysisFailureCount(0);
    // The failed request already advanced from Choose Screenshot to Vibe Check.
    // Replace that no-reply step with the same Testimonials route used by Skip.
    goToStep("testimonials", { replaceCurrent: true });
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
    <>
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
        onBeforeChooseScreenshot={consentGranted}
        onComplete={completeOnboarding}
        onDevicePreviewUsed={handleDevicePreviewUsed}
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
      <ScreenshotErrorPopup
        error={conversation.error}
        onChooseAnotherScreenshot={chooseReplacementFromSemanticError}
      />
    </>
  );
}
