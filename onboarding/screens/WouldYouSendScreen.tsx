import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function WouldYouSendScreen(props: OnboardingScreenProps) {
  return <OnboardingScreenScaffold {...props} />;
}
