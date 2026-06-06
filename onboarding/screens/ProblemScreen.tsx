import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function ProblemScreen(props: OnboardingScreenProps) {
  return <OnboardingScreenScaffold {...props} />;
}
