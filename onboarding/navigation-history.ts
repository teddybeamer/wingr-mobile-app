import { onboardingStepOrder } from "./data/onboardingConfig";
import type { OnboardingStepId } from "./types/onboarding";

export type OnboardingNavigationState = {
  currentStepId: OnboardingStepId;
  history: OnboardingStepId[];
};

export function createOnboardingNavigation(
  initialStepId: OnboardingStepId = onboardingStepOrder[0],
): OnboardingNavigationState {
  return { currentStepId: initialStepId, history: [] };
}

export function advanceOnboardingNavigation(
  state: OnboardingNavigationState,
): OnboardingNavigationState {
  const currentIndex = onboardingStepOrder.indexOf(state.currentStepId);
  const nextStepId = onboardingStepOrder[currentIndex + 1];
  if (!nextStepId) return state;
  return {
    currentStepId: nextStepId,
    history: [...state.history, state.currentStepId],
  };
}

export function goToOnboardingStep(
  state: OnboardingNavigationState,
  stepId: OnboardingStepId,
  { resetHistory = false }: { resetHistory?: boolean } = {},
): OnboardingNavigationState {
  if (state.currentStepId === stepId) {
    return resetHistory ? { ...state, history: [] } : state;
  }
  return {
    currentStepId: stepId,
    history: resetHistory ? [] : [...state.history, state.currentStepId],
  };
}

export function goBackInOnboarding(
  state: OnboardingNavigationState,
): OnboardingNavigationState {
  const previousStepId = state.history.at(-1);
  if (!previousStepId) return state;
  return {
    currentStepId: previousStepId,
    history: state.history.slice(0, -1),
  };
}
