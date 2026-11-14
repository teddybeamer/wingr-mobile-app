import { useState } from "react";

import { TheAngleCard } from "../components/conversation/TheAngleCard";
import { ReplyLoadingScreen } from "../components/conversation/ReplyLoadingScreen";
import { START_CONVERSATION_HERO_IMAGE } from "../lib/choose-hero";
import { PROFILE_LOADING_CHAT_MESSAGES } from "../lib/loading-chat";
import { ChooseScreenshotScreen } from "../screens/ChooseScreenshotScreen";
import { RepliesScreen } from "../screens/RepliesScreen";
import { ScreenshotChosenScreen } from "../screens/ScreenshotChosenScreen";
import { MOCK_ANGLE, MOCK_OPENERS } from "./mocks";
import { PreviewPage } from "./RepliesPreview";
import { sampleScreenshotUri } from "./samples";

// Start Conversation, screen by screen, with the sample profile and mock data.
// Buttons run but call nothing.
export function StartChoosePreview() {
  return (
    <ChooseScreenshotScreen
      body="Upload their profile, a post or any photo of them. We’ll find something worth starting a conversation about."
      heading="Let’s break the ice"
      heroImage={START_CONVERSATION_HERO_IMAGE}
      onBack={() => {}}
      onChooseScreenshot={() => {}}
      title="Start Conversation"
    />
  );
}

export function StartChosenPreview({
  errorMessage = null,
}: {
  errorMessage?: string | null;
}) {
  const [revealToken, setRevealToken] = useState<number | null>(1);
  return (
    <ScreenshotChosenScreen
      continueLabel="Get Conversation Starters"
      errorMessage={errorMessage}
      onBack={() => {}}
      onChangeScreenshot={() => {}}
      onGetReplies={() => {}}
      onRevealStarted={(token) =>
        setRevealToken((current) => (current === token ? null : current))
      }
      revealToken={revealToken}
      selectedScreenshotUri={sampleScreenshotUri("profile")}
      title="Start Conversation"
    />
  );
}

export function StartLoadingPreview() {
  return (
    <ReplyLoadingScreen
      accessibilityLabel="WiNGR is reading their picture"
      messages={PROFILE_LOADING_CHAT_MESSAGES}
    />
  );
}

export function TheAnglePreview({
  expanded,
  manyTopics = false,
}: {
  expanded: boolean;
  manyTopics?: boolean;
}) {
  const angle = manyTopics
    ? {
        ...MOCK_ANGLE,
        topics: [...MOCK_ANGLE.topics, "Very long topic name here"],
      }
    : MOCK_ANGLE;
  return (
    <PreviewPage>
      <TheAngleCard angle={angle} defaultExpanded={expanded} />
    </PreviewPage>
  );
}

export function OpenersScreenPreview({
  error = false,
  generating = false,
}: {
  error?: boolean;
  generating?: boolean;
}) {
  return (
    <RepliesScreen
      actionLabel="Get Opener"
      insight={<TheAngleCard angle={MOCK_ANGLE} />}
      isGeneratingReplies={generating}
      lastGeneratedReplyId={null}
      onBack={() => {}}
      onDismissReplyError={() => {}}
      onRefreshReplies={async () => true}
      onToneChange={async () => true}
      replies={MOCK_OPENERS.slice(0, 1)}
      scrollToInsight
      replyError={
        error
          ? {
              id: 1,
              kind: "opener",
              message:
                "WiNGR could not write another opener. Please try again.",
            }
          : null
      }
      selectedScreenshotUri={sampleScreenshotUri("profile")}
      selectedTone="playful"
      title="Start Conversation"
    />
  );
}
