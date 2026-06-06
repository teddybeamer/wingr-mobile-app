import { onboardingContent } from './onboardingContent';
import type { OnboardingFlowStep, OnboardingStepId } from '../types/onboarding';

export const onboardingStepOrder: OnboardingStepId[] = [
  'welcome',
  'problem',
  'change',
  'wouldYouSend',
  'privacy',
  'uploadScreenshot',
  'vibecheck',
  'replies',
  'rating',
  'paywall',
];

export const onboardingFlow: OnboardingFlowStep[] = onboardingStepOrder.map((id) => ({
  content: onboardingContent[id],
  id,
}));
