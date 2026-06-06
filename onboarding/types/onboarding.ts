export type OnboardingStepId =
  | 'welcome'
  | 'problem'
  | 'change'
  | 'wouldYouSend'
  | 'privacy'
  | 'uploadScreenshot'
  | 'vibecheck'
  | 'replies'
  | 'rating'
  | 'paywall';

export type OnboardingChoice = {
  id: string;
  title: string;
  description?: string;
};

export type OnboardingTitlePart = {
  color?: 'blue' | 'white';
  text: string;
};

export type OnboardingChatMessage = {
  id: string;
  text: string;
  side: 'user' | 'other';
};

export type OnboardingStepContent = {
  id: OnboardingStepId;
  eyebrow?: string;
  title: string;
  titleParts?: OnboardingTitlePart[];
  body: string;
  ctaLabel?: string;
  secondaryCtaLabel?: string;
  choices?: OnboardingChoice[];
  defaultChoiceId?: string;
  chatMessages?: OnboardingChatMessage[];
  footerNote?: string;
  requiresSelection?: boolean;
};

export type OnboardingFlowStep = {
  id: OnboardingStepId;
  content: OnboardingStepContent;
};

export type OnboardingScreenProps = {
  canGoBack: boolean;
  content: OnboardingStepContent;
  currentIndex: number;
  isLastStep: boolean;
  canContinue: boolean;
  onBack: () => void;
  onComplete: () => void;
  onNext: () => void;
  onSelectChoice: (choiceId: string) => void;
  onSkip: () => void;
  selectedChoiceId?: string;
  totalSteps: number;
};
