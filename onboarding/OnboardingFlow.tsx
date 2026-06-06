import type { ReactElement } from 'react';
import { ChangeScreen } from './screens/ChangeScreen';
import { PaywallScreen } from './screens/PaywallScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { ProblemScreen } from './screens/ProblemScreen';
import { RatingScreen } from './screens/RatingScreen';
import { RepliesScreen } from './screens/RepliesScreen';
import { UploadScreenShotScreen } from './screens/UploadScreenShotScreen';
import { VibecheckScreen } from './screens/VibecheckScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { WouldYouSendScreen } from './screens/WouldYouSendScreen';
import { useOnboardingFlow } from './hooks/useOnboardingFlow';
import type { OnboardingScreenProps, OnboardingStepId } from './types/onboarding';

type OnboardingFlowProps = {
  onComplete: () => void;
};

const screenMap: Record<OnboardingStepId, (props: OnboardingScreenProps) => ReactElement> = {
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
  } = useOnboardingFlow(onComplete);
  const ScreenComponent = screenMap[currentStep.id];

  return (
    <ScreenComponent
      canGoBack={canGoBack}
      canContinue={canContinue}
      content={currentStep.content}
      currentIndex={currentIndex}
      isLastStep={isLastStep}
      onBack={goBack}
      onComplete={onComplete}
      onNext={goNext}
      onSelectChoice={selectChoice}
      onSkip={skip}
      selectedChoiceId={selectedChoiceId}
      totalSteps={totalSteps}
    />
  );
}
