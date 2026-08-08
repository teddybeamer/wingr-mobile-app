import {
  InlineErrorCard,
  RepliesContent,
} from "../../components/conversation/ConversationContent";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

export function RepliesScreen(props: OnboardingScreenProps) {
  const { conversation } = props;
  const hasReplies = conversation.generatedReplies.length > 0;

  return (
    <OnboardingScreenScaffold {...props}>
      {hasReplies ? (
        <RepliesContent
          isGenerating={conversation.repliesStatus === "generating"}
          maxReplies={1}
          onRefreshReplies={conversation.refreshReplies}
          onToneChange={conversation.changeTone}
          replies={conversation.generatedReplies}
          selectedTone={conversation.selectedTone}
          showControls={false}
        />
      ) : null}

      {conversation.repliesStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            void conversation.generateRepliesForSelectedTone();
          }}
          primaryLabel="Retry"
        />
      ) : null}
    </OnboardingScreenScaffold>
  );
}
