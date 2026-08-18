import "./global.css";

import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import { useFonts } from "expo-font";
import * as Clipboard from "expo-clipboard";
import { Component, type ReactNode, useEffect, useRef, useState } from "react";
import {
  AltArrowDown,
  ArrowRight,
  Bolt,
  CheckCircle,
  ChatRound,
  Copy,
  Heart,
  Refresh,
  ShieldWarning,
  StarsMinimalistic,
} from "@solar-icons/react-native/Linear";
import type { Icon as SolarIcon } from "@solar-icons/react-native/lib/index";
import Svg, {
  Defs,
  Ellipse,
  FeGaussianBlur,
  Filter,
  LinearGradient,
  Rect,
  Stop,
} from "react-native-svg";
import {
  ActivityIndicator,
  Alert,
  Image,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import type {
  ReplyBatch,
  ReplyTone,
  RecommendedReplyTone,
  SuggestedReply,
  ToneOption,
  VibeCheck,
} from "./types/wingr";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { BackButton } from "./components/BackButton";
import { useConversationFlow } from "./hooks/useConversationFlow";
import {
  InlineErrorCard,
  ReplyActionBar,
  RepliesContent,
  VibeCheckCard,
} from "./components/conversation/ConversationContent";

const DEBUG_BOOT_PROBE = true;
const DEV_SKIP_ONBOARDING = true;

console.log("[Wingr boot] App module loaded");

const FONTS = {
  display: "ClashDisplay",
  displayMedium: "ClashDisplayMedium",
  body: "ClashGrotesk",
  bodyRegular: "ClashGroteskRegular",
};

const COLORS = {
  background: "#080808",
  blue: "#1970FD",
  white: "#F6F7FB",
  muted: "#B7B7BE",
  border: "#5B5B64",
  panel: "#101010",
  panelRaised: "#151515",
  green: "#21C57A",
  yellow: "#F6B94B",
  red: "#FF5A65",
  purple: "#6552FF",
  orange: "#D66A00",
  teal: "#00B8AF",
  teal700: "#0F766E",
  teal800: "#115E59",
  indigo700: "#4338CA",
  indigo800: "#3730A3",
};

// The Figma ellipse is the unblurred source layer. As with the reply-card
// glows, the oversized SVG gives the Gaussian filter room to render and the
// card itself is the clipping boundary.
const LANDING_CARD = {
  baseline: {
    contentGap: 16,
    copyGap: 6,
    height: 303,
    padding: 10,
    width: 328,
  },
  narrow: {
    contentGap: 12,
    copyGap: 4,
    padding: 8,
    widthThreshold: 280,
  },
} as const;

const LANDING_CARD_BOTTOM_GLOW = {
  ellipse: {
    bottomBelowCard: 20,
    fill: "#A5B4FC",
    height: 47,
    left: -14,
    opacity: 0.5,
    width: 353,
  },
  filterPadding: 150,
  stdDeviation: 75,
} as const;

const LANDING_BUTTON = {
  borderRadius: 20,
  height: 45,
  strokeWidth: 1,
  width: 308,
} as const;

const UPLOAD_SCREENSHOT_PREVIEW = {
  inset: 14,
  screenshotRadius: 16,
} as const;

const LANDING_BACKGROUND_GLOW = {
  ellipse: {
    fill: "#4338CA",
    heightRatio: 0.84,
    opacity: 0.32,
    width: 315,
    widthRatio: 0.68,
  },
  filterPadding: 150,
  screenOverscan: 54,
  stdDeviation: 70,
} as const;

function getLandingCardLayout(cardWidth: number) {
  const isNarrow = cardWidth < LANDING_CARD.narrow.widthThreshold;
  const padding = isNarrow
    ? LANDING_CARD.narrow.padding
    : LANDING_CARD.baseline.padding;
  const contentWidth = Math.max(0, cardWidth - padding * 2);

  return {
    cardGap: isNarrow
      ? LANDING_CARD.narrow.contentGap
      : LANDING_CARD.baseline.contentGap,
    contentGap: isNarrow
      ? LANDING_CARD.narrow.contentGap
      : LANDING_CARD.baseline.contentGap,
    contentWidth,
    copyGap: isNarrow
      ? LANDING_CARD.narrow.copyGap
      : LANDING_CARD.baseline.copyGap,
    heroHeight:
      (contentWidth / LANDING_BUTTON.width) * LANDING_CARD.baseline.height,
    padding,
  };
}

function getLandingCardBottomGlowCanvas(cardWidth: number) {
  const scale = cardWidth / LANDING_CARD.baseline.width;
  const ellipse = {
    bottomBelowCard: LANDING_CARD_BOTTOM_GLOW.ellipse.bottomBelowCard * scale,
    height: LANDING_CARD_BOTTOM_GLOW.ellipse.height * scale,
    left: LANDING_CARD_BOTTOM_GLOW.ellipse.left * scale,
    width: LANDING_CARD_BOTTOM_GLOW.ellipse.width * scale,
  };
  const filterPadding = LANDING_CARD_BOTTOM_GLOW.filterPadding * scale;

  return {
    bottom: -ellipse.bottomBelowCard - filterPadding,
    ellipse,
    filterPadding,
    height: ellipse.height + filterPadding * 2,
    left: ellipse.left - filterPadding,
    stdDeviation: LANDING_CARD_BOTTOM_GLOW.stdDeviation * scale,
    width: ellipse.width + filterPadding * 2,
    x: filterPadding + ellipse.width / 2,
    y: filterPadding + ellipse.height / 2,
  };
}

const REPLIES_SCREEN = {
  actionBarBottomOffset: 40,
  actionBarFallbackHeight: 61,
  actionBarScrollGap: 24,
  indigo950: "#1E1B4B",
  revealGap: 16,
};

const REPLIES_BACKGROUND_BLUR = {
  ellipse: {
    height: 650,
    top: 40,
    width: 187,
  },
  filterPadding: 150,
  stdDeviation: 75,
} as const;

const REPLIES_BACKGROUND_BLUR_CANVAS = {
  height:
    REPLIES_BACKGROUND_BLUR.ellipse.height +
    REPLIES_BACKGROUND_BLUR.filterPadding * 2,
  width:
    REPLIES_BACKGROUND_BLUR.ellipse.width +
    REPLIES_BACKGROUND_BLUR.filterPadding * 2,
  x:
    REPLIES_BACKGROUND_BLUR.filterPadding +
    REPLIES_BACKGROUND_BLUR.ellipse.width / 2,
  y:
    REPLIES_BACKGROUND_BLUR.filterPadding +
    REPLIES_BACKGROUND_BLUR.ellipse.height / 2,
} as const;

type Screen =
  | "onboarding"
  | "landing"
  | "upload"
  | "analyzing"
  | "speakerConfirmation"
  | "replies";
type MetricVariant = "interest" | "energy" | "risk" | "move";

type BootErrorBoundaryProps = {
  children: ReactNode;
};

type BootErrorBoundaryState = {
  error: Error | null;
};

class BootErrorBoundary extends Component<
  BootErrorBoundaryProps,
  BootErrorBoundaryState
> {
  state: BootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      "[Wingr boot] Render error boundary caught",
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.debugBootScreen}>
          <Text style={styles.debugBootTitle}>Wingr render error</Text>
          <Text style={styles.debugBootBody}>{this.state.error.message}</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const TONE_OPTIONS: ToneOption[] = [
  { value: "playful", label: "Playful", emoji: "🔥" },
  { value: "direct", label: "Direct", emoji: "🎯" },
  { value: "casualSmallTalk", label: "Casual", emoji: "😊" },
];

function getToneLabel(tone: ReplyTone | RecommendedReplyTone) {
  return (
    TONE_OPTIONS.find((option) => option.value === tone)?.label ?? "Playful"
  );
}

function getUnusedReplies(
  replyBatch: ReplyBatch,
  tone: ReplyTone,
  shownReplyIds: string[],
) {
  const shownIds = new Set(shownReplyIds);

  return (replyBatch[tone] ?? []).filter((reply) => !shownIds.has(reply.id));
}

function getVisibleRepliesForTone(
  replyBatch: ReplyBatch,
  tone: ReplyTone,
  shownReplyIds: string[],
) {
  return getUnusedReplies(replyBatch, tone, shownReplyIds).slice(0, 2);
}

function mergeReplyBatch(currentBatch: ReplyBatch, nextBatch: ReplyBatch) {
  return {
    ...currentBatch,
    ...nextBatch,
  };
}

function appendShownReplyIds(
  currentShownReplyIds: string[],
  replies: SuggestedReply[],
) {
  return [
    ...currentShownReplyIds,
    ...replies
      .map((reply) => reply.id)
      .filter((replyId) => !currentShownReplyIds.includes(replyId)),
  ];
}

function getConversationEnergyCopy(vibeCheck: VibeCheck) {
  const rawEnergy = vibeCheck.conversationEnergy.trim();
  const lowerEnergy = rawEnergy.toLowerCase();
  const debugTerms = ["detected", "speaker", "ocr", "confidence", "parsed"];
  const looksLikeInternalOutput = debugTerms.some((term) =>
    lowerEnergy.includes(term),
  );
  const hasSituationLanguage =
    rawEnergy.length >= 55 &&
    /\b(they|their|chat|conversation|reply|message|interest|momentum|move|room)\b/i.test(
      rawEnergy,
    );

  if (hasSituationLanguage && !looksLikeInternalOutput) {
    return rawEnergy;
  }

  if (
    lowerEnergy.includes("dry") ||
    lowerEnergy.includes("short") ||
    lowerEnergy.includes("low")
  ) {
    return "They're keeping it short, but there's still room to play.";
  }

  if (lowerEnergy.includes("playful") || lowerEnergy.includes("light")) {
    return "The conversation is light and playful, but it needs a more confident next move.";
  }

  if (lowerEnergy.includes("high") || lowerEnergy.includes("warm")) {
    return "There is good energy here, so keep momentum with a clear next move.";
  }

  if (vibeCheck.interestLevel === "Unclear") {
    return "There is some signal here, but the next reply should make the vibe easier to read.";
  }

  return "There's some interest here, but the chat needs a sharper reply to keep momentum.";
}

const METRIC_VARIANTS: Record<
  MetricVariant,
  {
    backgroundColor: string;
    blobColors: [string, string, string];
    iconColor: string;
    valueColor: string;
  }
> = {
  interest: {
    backgroundColor: "#4F46E5",
    blobColors: [
      "rgba(55, 48, 163, 0.88)",
      "rgba(67, 56, 202, 0.62)",
      "rgba(55, 48, 163, 0.42)",
    ],
    iconColor: "#C7D2FE",
    valueColor: "#6D5CFF",
  },
  energy: {
    backgroundColor: "#D97706",
    blobColors: [
      "rgba(146, 64, 14, 0.88)",
      "rgba(180, 83, 9, 0.62)",
      "rgba(146, 64, 14, 0.42)",
    ],
    iconColor: "#FDE68A",
    valueColor: "#F6B94B",
  },
  risk: {
    backgroundColor: "#DC2626",
    blobColors: [
      "rgba(153, 27, 27, 0.88)",
      "rgba(185, 28, 28, 0.62)",
      "rgba(153, 27, 27, 0.42)",
    ],
    iconColor: "#FECACA",
    valueColor: "#FF4D5E",
  },
  move: {
    backgroundColor: "#0D9488",
    blobColors: [
      "rgba(17, 94, 89, 0.88)",
      "rgba(15, 118, 110, 0.62)",
      "rgba(17, 94, 89, 0.42)",
    ],
    iconColor: "#99F6E4",
    valueColor: "#00C2B8",
  },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>(
    __DEV__ && DEV_SKIP_ONBOARDING ? "landing" : "onboarding",
  );
  const [showDebugBootScreen, setShowDebugBootScreen] =
    useState(DEBUG_BOOT_PROBE);
  const initialReplyGenerationIdRef = useRef(0);
  const initialReplyGenerationStartedIdRef = useRef<number | null>(null);
  const [queuedInitialReplyGenerationId, setQueuedInitialReplyGenerationId] =
    useState<number | null>(null);
  const conversation = useConversationFlow({ speakerPolicy: "confirm" });
  const {
    confirmSpeakerSide,
    error,
    generatedReplies,
    generateRepliesForSelectedTone,
    lastGeneratedReplyId,
    pendingSpeakerOcr,
    pickScreenshot,
    refreshReplies,
    repliesStatus,
    selectedScreenshotUri,
    selectedTone,
    vibeCheck,
  } = conversation;
  const [fontsLoaded] = useFonts({
    [FONTS.display]: require("./assets/fonts/ClashDisplay-Variable.ttf"),
    [FONTS.displayMedium]: require("./assets/fonts/ClashDisplay-Medium.ttf"),
    [FONTS.body]: require("./assets/fonts/ClashGrotesk-Variable.ttf"),
    [FONTS.bodyRegular]: require("./assets/fonts/ClashGrotesk-Regular.ttf"),
  });

  console.log("[Wingr boot] App render", {
    fontsLoaded,
    screen,
    showDebugBootScreen,
  });

  useEffect(() => {
    console.log("[Wingr boot] App mounted");

    if (!DEBUG_BOOT_PROBE) {
      return;
    }

    const timeoutId = setTimeout(() => {
      console.log("[Wingr boot] Hiding debug boot screen");
      setShowDebugBootScreen(false);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    console.log("[Wingr boot] Fonts loaded state changed", fontsLoaded);
  }, [fontsLoaded]);

  const cancelQueuedInitialReplyGeneration = () => {
    initialReplyGenerationIdRef.current += 1;
    initialReplyGenerationStartedIdRef.current = null;
    setQueuedInitialReplyGenerationId(null);
  };

  const queueInitialReplyGeneration = () => {
    const generationId = initialReplyGenerationIdRef.current + 1;

    initialReplyGenerationIdRef.current = generationId;
    initialReplyGenerationStartedIdRef.current = null;
    setQueuedInitialReplyGenerationId(generationId);
    setScreen("replies");
  };

  useEffect(() => {
    if (
      queuedInitialReplyGenerationId === null ||
      screen !== "replies" ||
      !vibeCheck ||
      initialReplyGenerationStartedIdRef.current ===
        queuedInitialReplyGenerationId
    ) {
      return;
    }

    const generationId = queuedInitialReplyGenerationId;

    initialReplyGenerationStartedIdRef.current = generationId;
    void generateRepliesForSelectedTone().finally(() => {
      if (initialReplyGenerationIdRef.current === generationId) {
        initialReplyGenerationStartedIdRef.current = null;
        setQueuedInitialReplyGenerationId(null);
      }
    });
  }, [
    generateRepliesForSelectedTone,
    queuedInitialReplyGenerationId,
    screen,
    vibeCheck,
  ]);

  if (showDebugBootScreen) {
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>
          JS mounted. Waiting for app render...
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    console.log("[Wingr boot] Waiting for fonts");
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>Loading fonts...</Text>
      </View>
    );
  }

  const handleConfirmSpeakerSide = async (userSide: "left" | "right") => {
    cancelQueuedInitialReplyGeneration();

    if (!pendingSpeakerOcr) {
      setScreen("upload");
      return;
    }

    setScreen("analyzing");
    const succeeded = await confirmSpeakerSide(userSide);

    if (succeeded) {
      queueInitialReplyGeneration();
    } else {
      Alert.alert(
        "Could not read screenshot",
        "Try another screenshot or upload again.",
      );
      setScreen("upload");
    }
  };

  const handleCancelSpeakerConfirmation = () => {
    cancelQueuedInitialReplyGeneration();
    conversation.cancelSpeakerConfirmation();
    setScreen("upload");
  };

  const handlePickScreenshotForUpload = async () => {
    const screenshotUri = await pickScreenshot();

    if (!screenshotUri) {
      if (conversation.error?.kind === "permission") {
        Alert.alert("Photo access needed", conversation.error.message);
      }
      return;
    }

    setScreen("upload");
  };

  const handleCheckSelectedScreenshot = async () => {
    cancelQueuedInitialReplyGeneration();

    if (__DEV__) {
      console.info("[Wingr flow] check vibe pressed", {
        hasScreenshot: Boolean(selectedScreenshotUri?.trim()),
        platform: Platform.OS,
      });
    }

    if (!selectedScreenshotUri) {
      await handlePickScreenshotForUpload();
      return;
    }

    setScreen("analyzing");
    const result = await conversation.analyzeScreenshot();

    if (result === "needsConfirmation") {
      setScreen("speakerConfirmation");
    } else if (result === "ready") {
      queueInitialReplyGeneration();
    } else {
      Alert.alert(
        "Could not read screenshot",
        conversation.error?.message ??
          "Try another screenshot or upload again.",
      );
      setScreen("upload");
    }
  };

  const handleToneChange = async (tone: ReplyTone) => {
    return conversation.changeTone(tone);
  };

  const handleRefreshReplies = async () => {
    return refreshReplies();
  };

  return (
    <BootErrorBoundary>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        {screen === "onboarding" ? (
          <OnboardingFlow onComplete={() => setScreen("landing")} />
        ) : null}

        {screen === "landing" ? (
          <LandingScreen onContinue={handlePickScreenshotForUpload} />
        ) : null}

        {screen === "upload" ? (
          <UploadScreenshotScreen
            errorMessage={
              error?.kind === "ocr" || error?.kind === "vibe"
                ? error.message
                : null
            }
            onBack={() => setScreen("landing")}
            onChangeScreenshot={handlePickScreenshotForUpload}
            onCheckVibe={handleCheckSelectedScreenshot}
            selectedScreenshotUri={selectedScreenshotUri}
          />
        ) : null}

        {screen === "analyzing" ? (
          <AnalyzingScreen selectedScreenshotUri={selectedScreenshotUri} />
        ) : null}

        {screen === "speakerConfirmation" ? (
          <SpeakerConfirmationScreen
            onBack={handleCancelSpeakerConfirmation}
            onConfirm={handleConfirmSpeakerSide}
            selectedScreenshotUri={selectedScreenshotUri}
          />
        ) : null}

        {screen === "replies" && vibeCheck ? (
          <RepliesScreen
            isGeneratingReplies={
              repliesStatus === "generating" ||
              queuedInitialReplyGenerationId !== null
            }
            lastGeneratedReplyId={lastGeneratedReplyId}
            onBack={() => {
              cancelQueuedInitialReplyGeneration();
              setScreen("upload");
            }}
            onRefreshReplies={handleRefreshReplies}
            onToneChange={handleToneChange}
            replies={generatedReplies}
            replyError={error?.kind === "replies" ? error.message : null}
            selectedScreenshotUri={selectedScreenshotUri}
            vibeCheck={vibeCheck}
            selectedTone={selectedTone}
          />
        ) : null}
      </SafeAreaView>
    </BootErrorBoundary>
  );
}

function LandingScreen({ onContinue }: { onContinue: () => void }) {
  const { height: viewportHeight, width: viewportWidth } =
    useWindowDimensions();
  const contentHeight = Math.min(617, Math.max(442, viewportHeight - 60));
  const maxCardWidth = Math.min(
    LANDING_CARD.baseline.width,
    Math.max(0, viewportWidth - 32),
  );
  const [cardSize, setCardSize] = useState({
    height: 439,
    width: maxCardWidth,
  });
  const cardWidth = Math.min(cardSize.width, maxCardWidth);
  const layout = getLandingCardLayout(cardWidth);

  const handleCardLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;

    setCardSize((currentSize) =>
      Math.abs(currentSize.height - height) < 0.5 &&
      Math.abs(currentSize.width - width) < 0.5
        ? currentSize
        : { height, width },
    );
  };

  return (
    <View style={styles.landingScreen}>
      <LandingBackgroundGlow />

      <View style={styles.landingHeader}>
        <Text style={styles.landingLogo}>Wingr</Text>
      </View>

      <View style={[styles.landingContent, { height: contentHeight }]}>
        <View
          onLayout={handleCardLayout}
          style={[
            styles.landingCard,
            { gap: layout.cardGap, padding: layout.padding },
          ]}
        >
          <LandingCardBottomGlow width={cardWidth} />
          <LandingCardGradientBorder
            height={cardSize.height}
            width={cardWidth}
          />

          <View style={[styles.landingHero, { height: layout.heroHeight }]}>
            <Image
              accessibilityIgnoresInvertColors
              style={styles.landingHeroBaseImage}
              resizeMode="stretch"
              source={require("./assets/images/HomeGraphic.png")}
            />
          </View>

          <View style={[styles.landingCardContent, { gap: layout.contentGap }]}>
            <View style={[styles.landingCopy, { gap: layout.copyGap }]}>
              <Text style={styles.landingTitle}>Get better replies</Text>
              <Text style={styles.landingBody} numberOfLines={2}>
                Get the vibe, then get the reply right.
              </Text>
            </View>

            <Pressable
              accessibilityLabel="Get Replies"
              accessibilityRole="button"
              onPress={onContinue}
              style={({ pressed }) => [
                styles.landingButton,
                { width: layout.contentWidth },
                pressed && styles.landingButtonPressed,
              ]}
            >
              <LandingButtonSurface width={layout.contentWidth} />
              <View style={styles.landingButtonContent}>
                <Text style={styles.landingButtonText}>Get Replies</Text>
                <Text style={styles.landingButtonEmoji}>🚀</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function LandingButtonSurface({ width }: { width: number }) {
  return (
    <Svg
      height={LANDING_BUTTON.height}
      pointerEvents="none"
      viewBox={`0 0 ${width} ${LANDING_BUTTON.height}`}
      width={width}
    >
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="landing-button-border-gradient"
          x1={0}
          x2={0}
          y1={0}
          y2={LANDING_BUTTON.height}
        >
          <Stop offset="0%" stopColor="#4338CA" />
          <Stop offset="100%" stopColor="#4338CA" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect
        fill={COLORS.indigo800}
        height={LANDING_BUTTON.height - LANDING_BUTTON.strokeWidth}
        rx={LANDING_BUTTON.borderRadius - LANDING_BUTTON.strokeWidth / 2}
        ry={LANDING_BUTTON.borderRadius - LANDING_BUTTON.strokeWidth / 2}
        stroke="url(#landing-button-border-gradient)"
        strokeWidth={LANDING_BUTTON.strokeWidth}
        width={Math.max(0, width - LANDING_BUTTON.strokeWidth)}
        x={LANDING_BUTTON.strokeWidth / 2}
        y={LANDING_BUTTON.strokeWidth / 2}
      />
    </Svg>
  );
}

function LandingCardGradientBorder({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  return (
    <Svg
      height={height}
      pointerEvents="none"
      style={styles.landingCardGradientBorder}
      width={width}
    >
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="landing-card-border-gradient"
          x1={0}
          x2={0}
          y1={0}
          y2={height}
        >
          <Stop offset="0%" stopColor="#262626" />
          <Stop offset="100%" stopColor="#262626" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect
        fill="none"
        height={Math.max(0, height - 1)}
        rx="20"
        ry="20"
        stroke="url(#landing-card-border-gradient)"
        strokeWidth="1"
        width={Math.max(0, width - 1)}
        x="0.5"
        y="0.5"
      />
    </Svg>
  );
}

function LandingCardBottomGlow({ width }: { width: number }) {
  const canvas = getLandingCardBottomGlowCanvas(width);

  return (
    <Svg
      height={canvas.height}
      pointerEvents="none"
      style={[
        styles.landingCardBottomGlow,
        {
          bottom: canvas.bottom,
          height: canvas.height,
          left: canvas.left,
          width: canvas.width,
        },
      ]}
      width={canvas.width}
    >
      <Defs>
        <Filter
          filterUnits="userSpaceOnUse"
          height={canvas.height}
          id="landing-card-bottom-glow"
          primitiveUnits="userSpaceOnUse"
          width={canvas.width}
          x={0}
          y={0}
        >
          <FeGaussianBlur stdDeviation={canvas.stdDeviation} />
        </Filter>
      </Defs>
      <Ellipse
        cx={canvas.x}
        cy={canvas.y}
        fill={LANDING_CARD_BOTTOM_GLOW.ellipse.fill}
        filter="url(#landing-card-bottom-glow)"
        opacity={LANDING_CARD_BOTTOM_GLOW.ellipse.opacity}
        rx={canvas.ellipse.width / 2}
        ry={canvas.ellipse.height / 2}
      />
    </Svg>
  );
}

function LandingBackgroundGlow() {
  const { height: viewportHeight, width: viewportWidth } =
    useWindowDimensions();
  const glowHeight =
    viewportHeight + LANDING_BACKGROUND_GLOW.screenOverscan * 2;
  const canvasWidth =
    LANDING_BACKGROUND_GLOW.ellipse.width +
    LANDING_BACKGROUND_GLOW.filterPadding * 2;
  const canvasHeight = glowHeight + LANDING_BACKGROUND_GLOW.filterPadding * 2;
  const ellipseWidth =
    LANDING_BACKGROUND_GLOW.ellipse.width *
    LANDING_BACKGROUND_GLOW.ellipse.widthRatio;
  const ellipseHeight =
    glowHeight * LANDING_BACKGROUND_GLOW.ellipse.heightRatio;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.landingBackgroundGlow,
        {
          height: canvasHeight,
          left:
            (viewportWidth - LANDING_BACKGROUND_GLOW.ellipse.width) / 2 -
            LANDING_BACKGROUND_GLOW.filterPadding,
          top:
            -LANDING_BACKGROUND_GLOW.screenOverscan -
            LANDING_BACKGROUND_GLOW.filterPadding,
          width: canvasWidth,
        },
      ]}
    >
      <Svg height={canvasHeight} width={canvasWidth}>
        <Defs>
          <Filter
            filterUnits="userSpaceOnUse"
            height={canvasHeight}
            id="landing-background-blur"
            primitiveUnits="userSpaceOnUse"
            width={canvasWidth}
            x={0}
            y={0}
          >
            <FeGaussianBlur
              stdDeviation={LANDING_BACKGROUND_GLOW.stdDeviation}
            />
          </Filter>
        </Defs>
        <Ellipse
          cx={
            LANDING_BACKGROUND_GLOW.filterPadding +
            LANDING_BACKGROUND_GLOW.ellipse.width / 2
          }
          cy={LANDING_BACKGROUND_GLOW.filterPadding + glowHeight / 2}
          fill={LANDING_BACKGROUND_GLOW.ellipse.fill}
          filter="url(#landing-background-blur)"
          opacity={LANDING_BACKGROUND_GLOW.ellipse.opacity}
          rx={ellipseWidth / 2}
          ry={ellipseHeight / 2}
        />
      </Svg>
    </View>
  );
}

function UploadScreenshotScreen({
  errorMessage,
  onBack,
  onChangeScreenshot,
  onCheckVibe,
  selectedScreenshotUri,
}: {
  errorMessage?: string | null;
  onBack: () => void;
  onChangeScreenshot: () => void;
  onCheckVibe: () => void;
  selectedScreenshotUri: string | null;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const maxCardWidth = Math.min(
    LANDING_CARD.baseline.width,
    Math.max(0, viewportWidth - 32),
  );
  const [cardSize, setCardSize] = useState({
    height: 487,
    width: maxCardWidth,
  });
  const [previewSize, setPreviewSize] = useState({ height: 0, width: 0 });
  const [screenshotAspectRatio, setScreenshotAspectRatio] = useState<
    number | null
  >(null);
  const cardWidth = Math.min(cardSize.width, maxCardWidth);
  const layout = getLandingCardLayout(cardWidth);
  const previewContentWidth = Math.max(
    0,
    previewSize.width - UPLOAD_SCREENSHOT_PREVIEW.inset * 2,
  );
  const previewContentHeight = Math.max(
    0,
    previewSize.height - UPLOAD_SCREENSHOT_PREVIEW.inset * 2,
  );
  const screenshotSize = screenshotAspectRatio
    ? previewContentWidth / previewContentHeight > screenshotAspectRatio
      ? {
          height: previewContentHeight,
          width: previewContentHeight * screenshotAspectRatio,
        }
      : {
          height: previewContentWidth / screenshotAspectRatio,
          width: previewContentWidth,
        }
    : null;

  useEffect(() => {
    setScreenshotAspectRatio(null);
  }, [selectedScreenshotUri]);

  const handleCardLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;

    setCardSize((currentSize) =>
      Math.abs(currentSize.height - height) < 0.5 &&
      Math.abs(currentSize.width - width) < 0.5
        ? currentSize
        : { height, width },
    );
  };

  return (
    <View className="flex-1 bg-[#080808] px-4 pt-4">
      <View className="flex-row items-center justify-between">
        <BackButton onPress={onBack} />

        <Text className="font-display text-[18px] font-bold leading-[22px] text-blue-700">
          Upload Screenshot
        </Text>

        <View className="h-9 w-9" />
      </View>

      <View className="mt-9 items-center">
        <View
          onLayout={handleCardLayout}
          style={[
            styles.landingCard,
            styles.uploadSelectedCard,
            { gap: layout.cardGap, padding: layout.padding },
          ]}
        >
          <LandingCardBottomGlow width={cardWidth} />
          <LandingCardGradientBorder
            height={cardSize.height}
            width={cardWidth}
          />

          <View style={styles.uploadSelectedCardContent}>
            <Pressable
              accessibilityLabel="Change Screenshot"
              accessibilityRole="button"
              className="h-10 self-center flex-row items-center justify-center gap-2 rounded-full border border-white/55 px-3"
              onPress={onChangeScreenshot}
            >
              <Refresh color="#FFFFFF" size={17} />
              <Text className="font-body text-[14px] font-semibold leading-[18px] text-white">
                Change Screenshot
              </Text>
            </Pressable>
          </View>

          <View
            className="aspect-[288/332] w-full items-center justify-center overflow-hidden rounded-[20px] bg-[#101010]"
            onLayout={({ nativeEvent }) => {
              const { height, width } = nativeEvent.layout;

              setPreviewSize((currentSize) =>
                Math.abs(currentSize.height - height) < 0.5 &&
                Math.abs(currentSize.width - width) < 0.5
                  ? currentSize
                  : { height, width },
              );
            }}
            style={styles.uploadSelectedCardContent}
          >
            {selectedScreenshotUri ? (
              <>
                <Image
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  source={require("./assets/images/uploadedscreenshotgraphic.png")}
                  style={styles.uploadScreenshotBackground}
                />
                <View
                  style={[
                    styles.uploadScreenshotMask,
                    screenshotSize
                      ? {
                          height: screenshotSize.height,
                          width: screenshotSize.width,
                        }
                      : styles.uploadScreenshotMaskLoading,
                  ]}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    onLoad={({ nativeEvent }) => {
                      const { height, width } = nativeEvent.source;

                      if (height > 0 && width > 0) {
                        setScreenshotAspectRatio(width / height);
                      }
                    }}
                    resizeMode="contain"
                    source={{ uri: selectedScreenshotUri }}
                    style={[
                      styles.uploadScreenshotImage,
                      !screenshotSize && styles.uploadScreenshotImageLoading,
                    ]}
                  />
                </View>
              </>
            ) : (
              <View className="h-full w-full items-center justify-center bg-[#101010] px-6">
                <Text className="text-center font-bodyRegular text-[15px] leading-[20px] text-[#A1A1AA]">
                  No screenshot selected
                </Text>
              </View>
            )}
          </View>

          <View
            pointerEvents="box-none"
            style={[styles.uploadSelectedCardContent, styles.uploadSelectedCta]}
          >
            <Pressable
              accessibilityLabel="Check the vibe"
              accessibilityRole="button"
              onPress={onCheckVibe}
              style={({ pressed }) => [
                styles.landingButton,
                { width: layout.contentWidth },
                pressed && styles.landingButtonPressed,
              ]}
            >
              <LandingButtonSurface width={layout.contentWidth} />
              <View style={styles.landingButtonContent}>
                <Text style={styles.landingButtonText}>Check the vibe</Text>
                <ArrowRight color="#FFFFFF" size={20} />
              </View>
            </Pressable>
          </View>
        </View>
        {errorMessage ? (
          <Text style={[styles.errorText, styles.uploadFlowError]}>
            {errorMessage}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function AnalyzingScreen({
  selectedScreenshotUri,
}: {
  selectedScreenshotUri: string | null;
}) {
  return (
    <View style={[styles.screen, styles.analyzingScreen]}>
      <Text style={styles.vibeHeaderTitle}>Reading chat</Text>
      {selectedScreenshotUri ? (
        <Image
          resizeMode="cover"
          source={{ uri: selectedScreenshotUri }}
          style={styles.analyzingImage}
        />
      ) : null}
      <ActivityIndicator color={COLORS.blue} size="large" />
      <Text style={styles.analyzingTitle}>Extracting the conversation...</Text>
      <Text style={styles.analyzingText}>
        Wingr is reading the screenshot and checking the vibe.
      </Text>
    </View>
  );
}

function SpeakerConfirmationScreen({
  onBack,
  onConfirm,
  selectedScreenshotUri,
}: {
  onBack: () => void;
  onConfirm: (userSide: "left" | "right") => void;
  selectedScreenshotUri: string | null;
}) {
  return (
    <View style={[styles.screen, styles.speakerConfirmationScreen]}>
      <View style={styles.vibeHeader}>
        <BackButton accessibilityLabel="Go back to upload" onPress={onBack} />
        <Text style={styles.vibeHeaderTitle}>Quick check</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.speakerConfirmationBody}>
        {selectedScreenshotUri ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={{ uri: selectedScreenshotUri }}
            style={styles.speakerConfirmationImage}
          />
        ) : null}

        <View style={styles.speakerConfirmationCard}>
          <Text style={styles.speakerConfirmationTitle}>
            Just checking — which side is you?
          </Text>
          <Text style={styles.speakerConfirmationText}>
            Wingr needs this once so it does not write replies to your own
            message.
          </Text>

          <View style={styles.speakerConfirmationButtons}>
            <TouchableOpacity
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Right side is me"
              onPress={() => onConfirm("right")}
              style={styles.speakerConfirmationButton}
            >
              <Text style={styles.speakerConfirmationButtonText}>
                Right side
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Left side is me"
              onPress={() => onConfirm("left")}
              style={[
                styles.speakerConfirmationButton,
                styles.speakerConfirmationSecondaryButton,
              ]}
            >
              <Text style={styles.speakerConfirmationButtonText}>
                Left side
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function VibeMetric({
  icon,
  label,
  value,
  variant,
  isLast,
  withMeter,
}: {
  icon: SolarIcon;
  label: string;
  value: string;
  variant: MetricVariant;
  isLast?: boolean;
  withMeter?: boolean;
}) {
  const config = METRIC_VARIANTS[variant];

  return (
    <View style={[styles.metricRow, isLast && styles.metricRowLast]}>
      <GlowIconContainer Icon={icon} variant={variant} />
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text
          style={[
            styles.metricValue,
            variant === "energy" && styles.metricValueBody,
            { color: config.valueColor },
          ]}
        >
          {value}
        </Text>
      </View>
      {withMeter ? (
        <View style={styles.meterTrack}>
          <View style={styles.meterFill} />
        </View>
      ) : null}
    </View>
  );
}

function GlowIconContainer({
  Icon,
  variant,
}: {
  Icon: SolarIcon;
  variant: MetricVariant;
}) {
  const config = METRIC_VARIANTS[variant];

  return (
    <View
      style={[
        styles.glowIconContainer,
        { backgroundColor: config.backgroundColor },
      ]}
    >
      <Svg
        height="34"
        pointerEvents="none"
        style={styles.glowSvg}
        viewBox="0 0 34 34"
        width="34"
      >
        <Defs>
          <Filter
            height="280%"
            id="blobBlurTopLeft"
            width="280%"
            x="-90%"
            y="-90%"
          >
            <FeGaussianBlur stdDeviation="14" />
          </Filter>
          <Filter
            height="280%"
            id="blobBlurTopRight"
            width="280%"
            x="-90%"
            y="-90%"
          >
            <FeGaussianBlur stdDeviation="14" />
          </Filter>
          <Filter
            height="280%"
            id="blobBlurBottom"
            width="280%"
            x="-90%"
            y="-90%"
          >
            <FeGaussianBlur stdDeviation="16" />
          </Filter>
        </Defs>
        <Ellipse
          cx="2"
          cy="7"
          fill={config.blobColors[0]}
          filter="url(#blobBlurTopLeft)"
          rx="20"
          ry="8"
          transform="rotate(-16 2 7)"
        />
        <Ellipse
          cx="31"
          cy="10"
          fill={config.blobColors[1]}
          filter="url(#blobBlurTopRight)"
          rx="20"
          ry="8"
          transform="rotate(18 31 10)"
        />
        <Ellipse
          cx="15"
          cy="33"
          fill={config.blobColors[2]}
          filter="url(#blobBlurBottom)"
          rx="20"
          ry="8"
          transform="rotate(-10 15 33)"
        />
      </Svg>
      <View style={styles.metricIconForeground}>
        <Icon color={config.iconColor} size={20} />
      </View>
    </View>
  );
}

function RepliesScreen({
  isGeneratingReplies,
  lastGeneratedReplyId,
  onBack,
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
  onRefreshReplies: () => Promise<boolean>;
  onToneChange: (tone: ReplyTone) => Promise<boolean>;
  replies: SuggestedReply[];
  replyError: string | null;
  selectedScreenshotUri: string | null;
  selectedTone: ReplyTone;
  vibeCheck: VibeCheck;
}) {
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

  return (
    <View style={[styles.screen, styles.repliesScreen]}>
      <RepliesBackgroundBlur />

      <View style={styles.repliesHeader}>
        <BackButton
          accessibilityLabel="Go back to Vibe Check"
          onPress={onBack}
        />
        <Text style={styles.repliesHeaderTitle}>Replies</Text>
        <View style={styles.repliesHeaderSpacer} />
      </View>

      <ScrollView
        bounces={false}
        contentContainerStyle={[
          styles.repliesScrollContent,
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
          style={styles.repliesConversation}
        >
          {selectedScreenshotUri ? (
            <View style={styles.repliesScreenshotFrame}>
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="contain"
                source={{ uri: selectedScreenshotUri }}
                style={styles.repliesScreenshot}
              />
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
            replies={replies}
            selectedTone={selectedTone}
            presentation="mainFeed"
            showControls={false}
            showTypingIndicator
          />
          {replyError ? (
            <InlineErrorCard
              message={replyError}
              onPrimaryAction={() => {
                void onRefreshReplies();
              }}
              primaryLabel="Try again"
            />
          ) : null}
        </View>
      </ScrollView>

      <View
        onLayout={(event) => {
          handleActionBarLayout(event.nativeEvent.layout.height);
        }}
        style={styles.repliesActionBarShell}
      >
        <BlurView
          blurReductionFactor={1}
          experimentalBlurMethod={
            Platform.OS === "android" ? "dimezisBlurView" : undefined
          }
          intensity={20}
          pointerEvents="none"
          style={styles.repliesActionBarBlur}
          tint="dark"
        />
        <View pointerEvents="none" style={styles.repliesActionBarTint} />
        <View style={styles.repliesActionBarContent}>
          <ReplyActionBar
            isGenerating={isGeneratingReplies}
            onRefreshReplies={onRefreshReplies}
            onToneChange={onToneChange}
            selectedTone={selectedTone}
          />
        </View>
      </View>
    </View>
  );
}

function RepliesBackgroundBlur() {
  const { width: viewportWidth } = useWindowDimensions();

  return (
    <View
      pointerEvents="none"
      style={[
        styles.repliesBackgroundBlur,
        {
          left: (viewportWidth - REPLIES_BACKGROUND_BLUR.ellipse.width) / 2,
        },
      ]}
    >
      <Svg
        height={REPLIES_BACKGROUND_BLUR_CANVAS.height}
        pointerEvents="none"
        style={styles.repliesBackgroundBlurSvg}
        width={REPLIES_BACKGROUND_BLUR_CANVAS.width}
      >
        <Defs>
          <Filter
            filterUnits="userSpaceOnUse"
            height={REPLIES_BACKGROUND_BLUR_CANVAS.height}
            id="replies-background-blur"
            primitiveUnits="userSpaceOnUse"
            width={REPLIES_BACKGROUND_BLUR_CANVAS.width}
            x={0}
            y={0}
          >
            <FeGaussianBlur
              stdDeviation={REPLIES_BACKGROUND_BLUR.stdDeviation}
            />
          </Filter>
        </Defs>
        <Ellipse
          cx={REPLIES_BACKGROUND_BLUR_CANVAS.x}
          cy={REPLIES_BACKGROUND_BLUR_CANVAS.y}
          fill={REPLIES_SCREEN.indigo950}
          filter="url(#replies-background-blur)"
          rx={REPLIES_BACKGROUND_BLUR.ellipse.width / 2}
          ry={REPLIES_BACKGROUND_BLUR.ellipse.height / 2}
        />
      </Svg>
    </View>
  );
}

function ReplyCard({
  copied,
  onCopy,
  recommended,
  reply,
}: {
  copied: boolean;
  onCopy: () => void;
  recommended: boolean;
  reply: SuggestedReply;
}) {
  return (
    <View
      style={[styles.replyCard, recommended && styles.recommendedReplyCard]}
    >
      {recommended ? (
        <View style={styles.recommendedBadge}>
          <StarsMinimalistic color="#4D8CFF" size={14} />
          <Text style={styles.recommendedBadgeText}>Recommended</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.replyCardBody,
          !recommended && styles.replyCardBodySecondary,
        ]}
      >
        <Text style={styles.replyText}>{reply.text}</Text>

        {recommended && reply.whyItWorks ? (
          <View style={styles.whyItWorks}>
            <Text style={styles.whyItWorksTitle}>Why it works:</Text>
            <Text style={styles.whyItWorksText}>{reply.whyItWorks}</Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Copy reply"
        onPress={onCopy}
        style={styles.copyButton}
      >
        {copied ? (
          <CheckCircle color={COLORS.white} size={16} />
        ) : (
          <Copy color={COLORS.white} size={16} />
        )}
        <Text style={styles.copyButtonText}>{copied ? "Copied" : "Copy"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ToneBottomSheet({
  onClose,
  onSelect,
  selectedTone,
  visible,
}: {
  onClose: () => void;
  onSelect: (tone: ReplyTone) => void;
  selectedTone: ReplyTone;
  visible: boolean;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={styles.sheetBackdrop}
      >
        <Pressable style={styles.sheetPanel}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose tone</Text>
          <View style={styles.toneOptions}>
            {TONE_OPTIONS.map((option) => {
              const selected = option.value === selectedTone;

              return (
                <TouchableOpacity
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={[
                    styles.toneOption,
                    selected && styles.toneOptionSelected,
                  ]}
                >
                  <View style={styles.toneOptionLeft}>
                    <Text style={styles.toneOptionEmoji}>{option.emoji}</Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.toneOptionText,
                        selected && styles.toneOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </View>
                  <View style={styles.toneOptionCheckSlot}>
                    {selected ? (
                      <CheckCircle color={COLORS.blue} size={21} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  landingBackgroundGlow: {
    position: "absolute",
  },
  landingBody: {
    color: "#D4D4D4",
    fontFamily: FONTS.displayMedium,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 17,
    maxWidth: 288,
  },
  landingButton: {
    alignItems: "center",
    backgroundColor: COLORS.indigo800,
    borderRadius: LANDING_BUTTON.borderRadius,
    elevation: 4,
    flexShrink: 0,
    height: LANDING_BUTTON.height,
    justifyContent: "center",
    maxWidth: "100%",
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    width: LANDING_BUTTON.width,
  },
  landingButtonContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    zIndex: 2,
  },
  landingButtonEmoji: {
    fontSize: 20,
    lineHeight: 20,
  },
  landingButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  landingButtonText: {
    color: "#FFFFFF",
    fontFamily: FONTS.display,
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 25,
  },
  landingCard: {
    backgroundColor: "#171717",
    borderRadius: 20,
    maxWidth: 328,
    overflow: "hidden",
    position: "relative",
    shadowColor: "#4338CA",
    shadowOffset: { height: 7, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    width: "100%",
  },
  landingCardBottomGlow: {
    position: "absolute",
    zIndex: 0,
  },
  landingCardContent: {
    position: "relative",
    width: "100%",
    zIndex: 5,
  },
  landingCardGradientBorder: {
    left: 0,
    position: "absolute",
    top: 0,
    zIndex: 4,
  },
  landingContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    position: "relative",
    width: "100%",
  },
  landingCopy: {
    paddingHorizontal: 8,
  },
  landingHeader: {
    alignItems: "center",
    height: 60,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  landingHero: {
    backgroundColor: "#0D0D0D",
    borderRadius: 20,
    overflow: "hidden",
    position: "relative",
    width: "100%",
    zIndex: 1,
  },
  landingHeroBaseImage: {
    height: "100%",
    width: "100%",
  },
  landingLogo: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
  },
  landingScreen: {
    alignItems: "center",
    backgroundColor: COLORS.background,
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  landingTitle: {
    color: "#FAFAFA",
    fontFamily: FONTS.display,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  debugBootBody: {
    color: "#B7B7BE",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  debugBootScreen: {
    alignItems: "center",
    backgroundColor: "#080808",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  debugBootTitle: {
    color: "#F6F7FB",
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    textAlign: "center",
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  logo: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
    textAlign: "center",
  },
  heroImage: {
    alignSelf: "center",
    height: 405,
    marginTop: 36,
    width: "100%",
  },
  uploadSection: {
    gap: 14,
    marginTop: 14,
  },
  uploadSelectedCard: {
    overflow: "hidden",
  },
  uploadSelectedCardContent: {
    position: "relative",
    zIndex: 5,
  },
  uploadSelectedCta: {
    zIndex: 5,
  },
  uploadFlowError: {
    marginTop: 12,
    maxWidth: 328,
    textAlign: "center",
  },
  uploadScreenshotBackground: {
    ...StyleSheet.absoluteFillObject,
    height: "100%",
    width: "100%",
  },
  uploadScreenshotImage: {
    height: "100%",
    width: "100%",
  },
  uploadScreenshotImageLoading: {
    opacity: 0,
  },
  uploadScreenshotMask: {
    borderRadius: UPLOAD_SCREENSHOT_PREVIEW.screenshotRadius,
    overflow: "hidden",
  },
  uploadScreenshotMaskLoading: {
    height: "100%",
    width: "100%",
  },
  sectionTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 27,
    fontWeight: "700",
    lineHeight: 33,
  },
  errorText: {
    color: COLORS.red,
    fontFamily: FONTS.bodyRegular,
    fontSize: 14,
    lineHeight: 19,
  },
  uploadButton: {
    alignItems: "center",
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 160,
    justifyContent: "center",
    overflow: "hidden",
  },
  uploadEmptyState: {
    alignItems: "center",
    gap: 16,
    justifyContent: "center",
  },
  uploadText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 24,
    textAlign: "center",
  },
  uploadSubtext: {
    color: COLORS.muted,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
    marginTop: 2,
    textAlign: "center",
  },
  plusButton: {
    alignItems: "center",
    borderColor: COLORS.white,
    borderRadius: 7,
    borderWidth: 1,
    height: 21,
    justifyContent: "center",
    width: 21,
  },
  plusText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 20,
  },
  selectedPreview: {
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  selectedImage: {
    opacity: 0.44,
  },
  selectedOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.42)",
    flex: 1,
    justifyContent: "center",
  },
  analyzingScreen: {
    alignItems: "center",
    gap: 18,
    justifyContent: "center",
    paddingBottom: 48,
  },
  analyzingImage: {
    backgroundColor: "#24242A",
    borderRadius: 20,
    height: 260,
    opacity: 0.68,
    width: 180,
  },
  analyzingTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
    textAlign: "center",
  },
  analyzingText: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 280,
    textAlign: "center",
  },
  speakerConfirmationScreen: {
    paddingHorizontal: 16,
  },
  speakerConfirmationBody: {
    alignItems: "center",
    gap: 18,
    paddingTop: 28,
  },
  speakerConfirmationImage: {
    backgroundColor: "#24242A",
    borderRadius: 20,
    height: 300,
    opacity: 0.72,
    width: 210,
  },
  speakerConfirmationCard: {
    backgroundColor: COLORS.panelRaised,
    borderColor: "#2B2B2F",
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    width: "100%",
  },
  speakerConfirmationTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
    textAlign: "center",
  },
  speakerConfirmationText: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
  },
  speakerConfirmationButtons: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 4,
  },
  speakerConfirmationButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flex: 1,
    height: 48,
    justifyContent: "center",
  },
  speakerConfirmationSecondaryButton: {
    backgroundColor: "#454545",
  },
  speakerConfirmationButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  vibeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  vibeHeaderTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
    textAlign: "center",
  },
  vibeCard: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 12,
    gap: 0,
    padding: 10,
  },
  vibeCardTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 4,
  },
  vibeCardTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
  },
  vibeSummaryText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
    marginBottom: 6,
  },
  metricRow: {
    alignItems: "center",
    borderBottomColor: "#29292E",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 67,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  glowIconContainer: {
    backgroundColor: "#062F2C",
    borderRadius: 10,
    height: 34,
    overflow: "hidden",
    position: "relative",
    width: 34,
  },
  glowSvg: {
    height: 34,
    left: 0,
    position: "absolute",
    top: 0,
    width: 34,
  },
  metricIconForeground: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    position: "relative",
    width: "100%",
    zIndex: 2,
  },
  metricCopy: {
    flex: 1,
  },
  metricLabel: {
    color: "#C9C9CF",
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
  },
  metricValue: {
    fontFamily: FONTS.display,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  metricValueBody: {
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 21,
  },
  meterTrack: {
    backgroundColor: "#56565C",
    borderRadius: 999,
    height: 6,
    overflow: "hidden",
    width: 110,
  },
  meterFill: {
    backgroundColor: COLORS.purple,
    borderRadius: 999,
    height: "100%",
    width: "50%",
  },
  repliesScreen: {
    overflow: "hidden",
    paddingHorizontal: 0,
    paddingTop: 0,
    position: "relative",
  },
  repliesHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 60,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 4,
    zIndex: 1,
  },
  repliesHeaderTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 24,
    textAlign: "center",
  },
  repliesHeaderSpacer: {
    height: 36,
    width: 36,
  },
  repliesBackgroundBlur: {
    height: REPLIES_BACKGROUND_BLUR.ellipse.height,
    position: "absolute",
    top: REPLIES_BACKGROUND_BLUR.ellipse.top,
    width: REPLIES_BACKGROUND_BLUR.ellipse.width,
  },
  repliesBackgroundBlurSvg: {
    left: -REPLIES_BACKGROUND_BLUR.filterPadding,
    position: "absolute",
    top: -REPLIES_BACKGROUND_BLUR.filterPadding,
  },
  repliesScrollContent: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  repliesConversation: {
    gap: 8,
    width: "100%",
  },
  repliesScreenshotFrame: {
    alignSelf: "center",
    backgroundColor: "#171717",
    borderRadius: 11,
    height: 182,
    overflow: "hidden",
    width: 84,
  },
  repliesScreenshot: {
    height: "100%",
    width: "100%",
  },
  repliesActionBarShell: {
    alignSelf: "center",
    borderRadius: 30,
    bottom: REPLIES_SCREEN.actionBarBottomOffset,
    elevation: 6,
    overflow: "hidden",
    padding: 8,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    width: 332,
    zIndex: 2,
  },
  repliesActionBarBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  repliesActionBarTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(38, 38, 38, 0.50)",
  },
  repliesActionBarContent: {
    position: "relative",
    width: "100%",
    zIndex: 1,
  },
  repliesControlsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  toneSelector: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#B7B7BE",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    flexDirection: "row",
    gap: 9,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 22,
    width: 190,
  },
  toneSelectorText: {
    color: "#D6D6DB",
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
    minWidth: 0,
  },
  replyCards: {
    gap: 14,
    width: "100%",
  },
  repliesLoadingCard: {
    alignItems: "center",
    backgroundColor: "#151515",
    borderColor: "#2B2B2F",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    minHeight: 164,
    justifyContent: "center",
    padding: 20,
    width: "100%",
  },
  repliesLoadingText: {
    color: "#D6D6DB",
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 21,
  },
  replyCard: {
    backgroundColor: "#151515",
    borderColor: "#2B2B2F",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    width: "100%",
  },
  recommendedReplyCard: {
    backgroundColor: "#0C111D",
    borderColor: COLORS.blue,
    borderWidth: 1,
  },
  recommendedBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#15265E",
    borderRadius: 999,
    flexDirection: "row",
    gap: 5,
    height: 22,
    paddingHorizontal: 10,
  },
  recommendedBadgeText: {
    color: "#4D8CFF",
    fontFamily: FONTS.bodyRegular,
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 15,
  },
  replyCardBody: {
    gap: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
  },
  replyCardBodySecondary: {
    gap: 0,
    paddingBottom: 18,
    paddingTop: 26,
  },
  replyText: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 23,
    fontWeight: "700",
    lineHeight: 30,
  },
  whyItWorks: {
    gap: 2,
  },
  whyItWorksTitle: {
    color: "#D6D6DB",
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 17,
  },
  whyItWorksText: {
    color: "#D6D6DB",
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 16,
  },
  copyButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    height: 48,
    justifyContent: "center",
    marginTop: 26,
    width: "100%",
  },
  copyButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 19,
    fontWeight: "600",
    lineHeight: 24,
  },
  newRepliesButton: {
    alignItems: "center",
    backgroundColor: "#454545",
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
  },
  newRepliesButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  sheetBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetPanel: {
    alignItems: "stretch",
    backgroundColor: "#111113",
    borderTopColor: "#2B2B2F",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    gap: 18,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#4A4A50",
    borderRadius: 999,
    height: 5,
    width: 48,
  },
  sheetTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
    textAlign: "center",
  },
  toneOptions: {
    gap: 12,
    width: "100%",
  },
  toneOption: {
    alignItems: "center",
    backgroundColor: "#18181B",
    borderColor: "#2B2B2F",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 24,
    width: "100%",
  },
  toneOptionSelected: {
    backgroundColor: "#0C1427",
    borderColor: COLORS.blue,
  },
  toneOptionLeft: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  toneOptionEmoji: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: "center",
    width: 24,
  },
  toneOptionText: {
    color: "rgba(255, 255, 255, 0.92)",
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 24,
    minWidth: 0,
  },
  toneOptionTextSelected: {
    color: "#6EA0FF",
  },
  toneOptionCheckSlot: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
    width: 24,
  },
});
