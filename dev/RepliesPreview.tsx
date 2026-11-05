import { ScrollView, View } from "react-native";

import {
  RepliesContent,
  VibeCheckCard,
} from "../components/conversation/ConversationContent";
import { colors, layout } from "../theme";
import { RepliesScreen } from "../screens/RepliesScreen";
import { MOCK_REPLIES, MOCK_VIBE_CHECK } from "./mocks";
import { sampleScreenshotUri } from "./samples";

function PreviewPage({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <ScrollView
        contentContainerStyle={{
          gap: 12,
          padding: layout.pageGutter,
          paddingTop: layout.headerHeight,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// The Vibe Check card on its own, collapsed or open, on the screen background.
// `longText` makes the analysis three times as long, to see the open card's glow
// grow with it.
export function VibeCheckPreview({
  expanded,
  longText = false,
}: {
  expanded: boolean;
  longText?: boolean;
}) {
  const vibeCheck = longText
    ? {
        ...MOCK_VIBE_CHECK,
        summary: [1, 2, 3].map(() => MOCK_VIBE_CHECK.summary).join(" "),
      }
    : MOCK_VIBE_CHECK;

  return (
    <PreviewPage>
      <VibeCheckCard
        defaultExpanded={expanded}
        presentation="inlineExpandable"
        vibeCheck={vibeCheck}
      />
    </PreviewPage>
  );
}

// The Vibe Check and the reply cards as the Get Replies feed shows them (and
// as onboarding shows them, with `maxReplies` 1).
export function ReplyCardsPreview({
  generating = false,
  maxReplies,
}: {
  generating?: boolean;
  maxReplies?: number;
}) {
  return (
    <PreviewPage>
      <VibeCheckCard
        presentation="inlineExpandable"
        vibeCheck={MOCK_VIBE_CHECK}
      />
      <RepliesContent
        isGenerating={generating}
        maxReplies={maxReplies}
        onRefreshReplies={async () => true}
        onToneChange={async () => true}
        presentation="mainFeed"
        replies={MOCK_REPLIES}
        selectedTone="playful"
        showControls={false}
        showTypingIndicator
      />
    </PreviewPage>
  );
}

// The whole Get Replies screen with mock data. The buttons run but call
// nothing: refreshing and changing tone just resolve.
export function RepliesScreenPreview({
  error = false,
  generating = false,
  noScreenshot = false,
}: {
  error?: boolean;
  generating?: boolean;
  noScreenshot?: boolean;
}) {
  return (
    <RepliesScreen
      isGeneratingReplies={generating}
      lastGeneratedReplyId={null}
      onBack={() => {}}
      onDismissReplyError={() => {}}
      onRefreshReplies={async () => true}
      onToneChange={async () => true}
      replies={MOCK_REPLIES}
      replyError={
        error
          ? {
              id: 1,
              kind: "replies",
              message: "WiNGR could not generate a new reply. Try again.",
            }
          : null
      }
      selectedScreenshotUri={
        noScreenshot ? null : sampleScreenshotUri("portrait")
      }
      selectedTone="playful"
      vibeCheck={MOCK_VIBE_CHECK}
    />
  );
}
