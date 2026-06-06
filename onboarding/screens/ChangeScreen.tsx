import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function ChangeScreen(props: OnboardingScreenProps) {
  return <OnboardingScreenScaffold {...props} />;
}
