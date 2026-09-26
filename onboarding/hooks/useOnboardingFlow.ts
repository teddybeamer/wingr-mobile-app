import { useMemo, useState } from "react";
import { onboardingFlow } from "../data/onboardingConfig";
import {
  advanceOnboardingNavigation,
  createOnboardingNavigation,
  goBackInOnboarding,
  goToOnboardingStep,
} from "../navigation-history";
import type { OnboardingStepId } from "../types/onboarding";

export function useOnboardingFlow(
  onComplete: () => void | Promise<void>,
  initialStepId?: OnboardingStepId,
) {
  const [navigation, setNavigation] = useState(() =>
    createOnboardingNavigation(initialStepId),
  );
  const [selectedChoices, setSelectedChoices] = useState<
    Record<string, string>
  >({});
  const totalSteps = onboardingFlow.length;
  const currentIndex = onboardingFlow.findIndex(
    (step) => step.id === navigation.currentStepId,
  );
  const currentStep = onboardingFlow[currentIndex];
  const isLastStep = currentIndex === totalSteps - 1;
  const canGoBack = navigation.history.length > 0;
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
        setNavigation(goBackInOnboarding);
      },
      goToStep: (
        stepId: OnboardingStepId,
        options?: { replaceCurrent?: boolean; resetHistory?: boolean },
      ) => {
        setNavigation((current) =>
          goToOnboardingStep(current, stepId, options),
        );
      },
      goNext: (force = false) => {
        if (!force && !canContinue) {
          return;
        }

        if (isLastStep) {
          onComplete();
          return;
        }

        setNavigation(advanceOnboardingNavigation);
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
      isLastStep,
      navigation.history.length,
      onComplete,
      selectedChoiceId,
      totalSteps,
    ],
  );
}
