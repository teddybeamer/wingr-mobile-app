import type { OnboardingStepId } from "../onboarding/types/onboarding";
import { hasClaimedOnboardingReply } from "./onboarding-claim";
import {
  getOnboardingReplyResumeStep,
  markOnboardingClaimRecovered,
  type OnboardingReplyResumeStep,
} from "./onboarding-progress";

export async function resolveOnboardingResumeStep({
  claimedOnServer = hasClaimedOnboardingReply,
  initialStepId,
  localResumeStep = getOnboardingReplyResumeStep,
  markRecovered = markOnboardingClaimRecovered,
  userId,
}: {
  claimedOnServer?: () => Promise<boolean>;
  initialStepId?: OnboardingStepId;
  localResumeStep?: (
    userId: string,
  ) => Promise<OnboardingReplyResumeStep | null>;
  markRecovered?: (userId: string) => Promise<void>;
  userId: string;
}): Promise<OnboardingStepId | undefined> {
  if (initialStepId) return initialStepId;

  const storedStep = await localResumeStep(userId);
  if (storedStep) return storedStep;
  if (!(await claimedOnServer())) return undefined;

  await markRecovered(userId).catch(() => {
    // The authoritative server claim still determines the safe resume step.
  });
  return "rating";
}

export async function recoverOnboardingReplyUsed({
  errorCode,
  markRecovered = markOnboardingClaimRecovered,
  userId,
}: {
  errorCode?: string;
  markRecovered?: (userId: string) => Promise<void>;
  userId: string;
}) {
  if (errorCode !== "onboarding_reply_used") return null;
  await markRecovered(userId).catch(() => {
    // Do not strand the user if local recovery persistence is unavailable.
  });
  return "rating" as const;
}
