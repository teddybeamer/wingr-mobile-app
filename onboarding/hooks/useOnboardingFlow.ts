import { useMemo, useState } from "react";
import { onboardingFlow } from "../data/onboardingConfig";
import type { OnboardingStepId } from "../types/onboarding";

export function useOnboardingFlow(
  onComplete: () => void | Promise<void>,
  initialStepId?: OnboardingStepId,
) {
  const initialIndex = Math.max(
    onboardingFlow.findIndex((step) => step.id === initialStepId),
    0,
  );
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [selectedChoices, setSelectedChoices] = useState<
    Record<string, string>
  >({});
  const totalSteps = onboardingFlow.length;
  const currentStep = onboardingFlow[currentIndex];
  const isLastStep = currentIndex === totalSteps - 1;
  const canGoBack = currentIndex > initialIndex;
  const selectedChoiceId =
    selectedChoices[currentStep.id] ?? currentStep.content.defaultChoiceId;
  const canContinue =
    !currentStep.content.requiresSelection || Boolean(selectedChoiceId);

  return useMemo(
    () => ({
      canGoBack,
      canContinue,
      currentIndex,
      currentStep,
      goBack: () => {
        setCurrentIndex((index) => Math.max(index - 1, initialIndex));
      },
      goToStep: (stepId: OnboardingStepId) => {
        const nextIndex = onboardingFlow.findIndex(
          (step) => step.id === stepId,
        );
        if (nextIndex >= initialIndex) setCurrentIndex(nextIndex);
      },
      goNext: (force = false) => {
        if (!force && !canContinue) {
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
      skip: () => void onComplete(),
      totalSteps,
    }),
    [
      canContinue,
      canGoBack,
      currentIndex,
      currentStep,
      initialIndex,
      isLastStep,
      onComplete,
      selectedChoiceId,
      totalSteps,
    ],
  );
}
