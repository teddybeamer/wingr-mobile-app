import { BlurView } from "expo-blur";
import { useRef, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { FittedScreenshot } from "../components/FittedScreenshot";
import { GlowEllipse } from "../components/GlowEllipse";
import { HeaderBackButton } from "../components/HeaderBackButton";
import { ScreenHeader, ScreenHeaderTitle } from "../components/ScreenHeader";
import {
  ScreenshotPreviewModal,
  type WindowRect,
} from "../components/ScreenshotPreviewModal";
import {
  InlineErrorCard,
  RepliesContent,
  ReplyActionBar,
  VibeCheckCard,
} from "../components/conversation/ConversationContent";
import type { ConversationFlowError } from "../hooks/useConversationFlow";
import { getReplyErrorPresentation } from "../lib/reply-limit";
import { colors, layout, radii, spacing, surfaces } from "../theme";
import type { ReplyTone, SuggestedReply, VibeCheck } from "../types/wingr";

const STAGE_BACKDROP = require("../assets/images/redesign/choose/stage-backdrop.jpg");

// Figma: the stage is 328 x 208 with the screenshot (83.6 x 182) 11 px from its
// top. It fills the width between the page gutters, so the height follows.
const STAGE_ASPECT_RATIO = 328 / 208;
const STAGE_PADDING = { bottom: 15, horizontal: 16, top: 11 } as const;

const REPLIES_SCREEN = {
  // Space between the bottom of the screen and the action bar.
  actionBarBottomOffset: spacing.xl,
  actionBarFallbackHeight: 56,
  actionBarScrollGap: 24,
  revealGap: 16,
};

// The soft indigo light down the middle of the screen (Figma "BG BLUR").
const BACKGROUND_GLOW = { blur: 75, rx: 93.5, ry: 325, top: 40 } as const;
const BACKGROUND_GLOW_WIDTH = BACKGROUND_GLOW.rx * 2 + BACKGROUND_GLOW.blur * 4;
const BACKGROUND_GLOW_HEIGHT =
  BACKGROUND_GLOW.ry * 2 + BACKGROUND_GLOW.blur * 4;

export function RepliesScreen({
  isGeneratingReplies,
  lastGeneratedReplyId,
  onBack,
  onDismissReplyError,
  onRefreshReplies,
  onToneChange,
  replies,
  replyError,
  selectedScreenshotUri,
  selectedTone,
  vibeCheck,
}: {
  isGeneratingReplies: boolean;
  lastGeneratedReplyId: string | null;
  onBack: () => void;
  onDismissReplyError: () => void;
  onRefreshReplies: () => Promise<boolean>;
  onToneChange: (tone: ReplyTone) => Promise<boolean>;
  replies: SuggestedReply[];
  replyError: ConversationFlowError | null;
  selectedScreenshotUri: string | null;
  selectedTone: ReplyTone;
  vibeCheck: VibeCheck;
}) {
  const errorPresentation = replyError
    ? getReplyErrorPresentation(replyError)
    : null;
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const actionBarHeightRef = useRef(REPLIES_SCREEN.actionBarFallbackHeight);
  const repliesConversationOffsetYRef = useRef<number | null>(null);
  const repliesContentOffsetYRef = useRef<number | null>(null);
  const pendingReplyLayoutRef = useRef<{
    height: number;
    y: number;
  } | null>(null);
  const [actionBarHeight, setActionBarHeight] = useState(
    REPLIES_SCREEN.actionBarFallbackHeight,
  );
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  // The preview shows the screenshot itself while it is open, so this copy is
  // hidden for that time.
  const [isScreenshotHidden, setIsScreenshotHidden] = useState(false);
  const [previewSource, setPreviewSource] = useState<WindowRect | null>(null);
  const screenshotFrameRef = useRef<View>(null);

  // Scrolls a newly generated reply into view above the action bar.
  const revealPendingReply = () => {
    const layout = pendingReplyLayoutRef.current;
    const repliesConversationOffsetY = repliesConversationOffsetYRef.current;
    const repliesContentOffsetY = repliesContentOffsetYRef.current;
    const visibleViewportHeight =
      scrollViewportHeightRef.current -
      actionBarHeightRef.current -
      REPLIES_SCREEN.actionBarBottomOffset;

    if (
      !layout ||
      repliesConversationOffsetY === null ||
      repliesContentOffsetY === null ||
      visibleViewportHeight <= 0
    ) {
      return;
    }

    const requiredOffset = Math.max(
      0,
      repliesConversationOffsetY +
        repliesContentOffsetY +
        layout.y +
        layout.height +
        REPLIES_SCREEN.revealGap -
        visibleViewportHeight,
    );

    pendingReplyLayoutRef.current = null;

    if (requiredOffset <= scrollOffsetRef.current + 2) {
      return;
    }

    scrollOffsetRef.current = requiredOffset;
    scrollViewRef.current?.scrollTo({ animated: true, y: requiredOffset });
  };

  const requestReplyReveal = (layout: { height: number; y: number }) => {
    pendingReplyLayoutRef.current = layout;
    requestAnimationFrame(revealPendingReply);
  };

  const handleActionBarLayout = (height: number) => {
    const nextHeight = Math.ceil(height);

    if (Math.abs(actionBarHeightRef.current - nextHeight) < 1) {
      return;
    }

    actionBarHeightRef.current = nextHeight;
    setActionBarHeight(nextHeight);
    requestAnimationFrame(revealPendingReply);
  };

  // Remember where the screenshot is on screen so the preview can grow out of
  // that spot.
  const openPreview = () => {
    const open = (rect: WindowRect | null) => {
      setPreviewSource(rect);
      setIsPreviewVisible(true);
    };
    const frame = screenshotFrameRef.current;
    if (!frame) {
      open(null);
      return;
    }
    frame.measureInWindow((x, y, width, height) => {
      open(width > 0 && height > 0 ? { height, width, x, y } : null);
    });
  };

  return (
    <View style={styles.screen}>
      <GlowEllipse
        blur={BACKGROUND_GLOW.blur}
        fill={colors.indigo950}
        rx={BACKGROUND_GLOW.rx}
        ry={BACKGROUND_GLOW.ry}
        style={styles.backgroundGlow}
      />

      <ScreenHeader
        center={<ScreenHeaderTitle>Get Replies</ScreenHeaderTitle>}
        left={<HeaderBackButton onPress={onBack} />}
      />

      <ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              actionBarHeight +
              REPLIES_SCREEN.actionBarBottomOffset +
              REPLIES_SCREEN.actionBarScrollGap,
          },
        ]}
        onLayout={(event) => {
          scrollViewportHeightRef.current = event.nativeEvent.layout.height;
          revealPendingReply();
        }}
        onScroll={(event) => {
          scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        ref={scrollViewRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View
          onLayout={(event) => {
            repliesConversationOffsetYRef.current = event.nativeEvent.layout.y;
            revealPendingReply();
          }}
          style={styles.conversation}
        >
          {selectedScreenshotUri ? (
            <View style={styles.stage}>
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                source={STAGE_BACKDROP}
                style={styles.stageBackdrop}
              />
              <View style={styles.stageScreenshot}>
                <FittedScreenshot
                  frameRef={screenshotFrameRef}
                  hidden={isScreenshotHidden}
                  shadow
                  uri={selectedScreenshotUri}
                />
                <Pressable
                  accessibilityLabel="Preview screenshot"
                  accessibilityRole="button"
                  onPress={openPreview}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </View>
          ) : null}
          <VibeCheckCard
            presentation="inlineExpandable"
            vibeCheck={vibeCheck}
          />
          <RepliesContent
            isGenerating={isGeneratingReplies}
            lastGeneratedReplyId={lastGeneratedReplyId}
            onContentLayout={(layout) => {
              repliesContentOffsetYRef.current = layout.y;
              revealPendingReply();
            }}
            onRefreshReplies={onRefreshReplies}
            onReplyLayout={requestReplyReveal}
            onToneChange={onToneChange}
            presentation="mainFeed"
            replies={replies}
            selectedTone={selectedTone}
            showControls={false}
            showTypingIndicator
          />
          {errorPresentation ? (
            <InlineErrorCard
              message={errorPresentation.message}
              onPrimaryAction={
                errorPresentation.dismiss
                  ? onDismissReplyError
                  : () => {
                      void onRefreshReplies();
                    }
              }
              primaryLabel={errorPresentation.primaryLabel}
              title={errorPresentation.title}
            />
          ) : null}
        </View>
      </ScrollView>

      <View
        onLayout={(event) => {
          handleActionBarLayout(event.nativeEvent.layout.height);
        }}
        style={styles.actionBarShell}
      >
        <BlurView
          blurReductionFactor={1}
          experimentalBlurMethod={
            Platform.OS === "android" ? "dimezisBlurView" : undefined
          }
          intensity={20}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint="dark"
        />
        <View pointerEvents="none" style={styles.actionBarTint} />
        <ReplyActionBar
          isGenerating={isGeneratingReplies}
          onRefreshReplies={onRefreshReplies}
          onToneChange={onToneChange}
          selectedTone={selectedTone}
        />
      </View>

      <ScreenshotPreviewModal
        onClose={() => setIsPreviewVisible(false)}
        onClosed={() => setIsScreenshotHidden(false)}
        onOpening={() => setIsScreenshotHidden(true)}
        sourceRect={previewSource}
        uri={selectedScreenshotUri}
        visible={isPreviewVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionBarShell: {
    alignSelf: "center",
    borderRadius: 30,
    bottom: REPLIES_SCREEN.actionBarBottomOffset,
    elevation: 6,
    overflow: "hidden",
    padding: spacing.sm,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  actionBarTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: surfaces.actionBar,
  },
  // Centred horizontally, top edge at the Figma ellipse position.
  backgroundGlow: {
    left: "50%",
    marginLeft: -BACKGROUND_GLOW_WIDTH / 2,
    top: BACKGROUND_GLOW.top + BACKGROUND_GLOW.ry - BACKGROUND_GLOW_HEIGHT / 2,
  },
  conversation: { gap: spacing.lg, width: "100%" },
  scrollContent: { paddingHorizontal: layout.pageGutter },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  stage: {
    aspectRatio: STAGE_ASPECT_RATIO,
    borderRadius: radii.lg,
    overflow: "hidden",
    width: "100%",
  },
  stageBackdrop: {
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  stageScreenshot: {
    ...StyleSheet.absoluteFillObject,
    paddingBottom: STAGE_PADDING.bottom,
    paddingHorizontal: STAGE_PADDING.horizontal,
    paddingTop: STAGE_PADDING.top,
  },
});
