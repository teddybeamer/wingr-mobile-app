import { useMemo, useState } from 'react';
import { onboardingFlow } from '../data/onboardingConfig';

export function useOnboardingFlow(onComplete: () => void) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({});
  const totalSteps = onboardingFlow.length;
  const currentStep = onboardingFlow[currentIndex];
  const isLastStep = currentIndex === totalSteps - 1;
  const canGoBack = currentIndex > 0;
  const selectedChoiceId = selectedChoices[currentStep.id] ?? currentStep.content.defaultChoiceId;
  const canContinue = !currentStep.content.requiresSelection || Boolean(selectedChoiceId);

  return useMemo(
    () => ({
      canGoBack,
      canContinue,
      currentIndex,
      currentStep,
      goBack: () => {
        setCurrentIndex((index) => Math.max(index - 1, 0));
      },
      goNext: () => {
        if (!canContinue) {
          return;
        }

        if (isLastStep) {
          onComplete();
          return;
        }

        setCurrentIndex((index) => Math.min(index + 1, totalSteps - 1));
      },
      isLastStep,
      selectedChoiceId,
      selectChoice: (choiceId: string) => {
        setSelectedChoices((current) => ({
          ...current,
          [currentStep.id]: choiceId,
        }));
      },
      skip: onComplete,
      totalSteps,
    }),
    [
      canContinue,
      canGoBack,
      currentIndex,
      currentStep,
      isLastStep,
      onComplete,
      selectedChoiceId,
      totalSteps,
    ],
  );
}
