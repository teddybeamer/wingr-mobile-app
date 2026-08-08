import * as Clipboard from "expo-clipboard";
import { BlurView } from "expo-blur";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  AltArrowDown,
  Bolt,
  CheckCircle,
  ChatRound,
  Copy,
  EmojiFunnyCircle,
  FireMinimalistic,
  Heart,
  Refresh,
  ShieldWarning,
  StarsMinimalistic,
  Waterdrop,
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
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  type LayoutChangeEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  TouchableOpacity,
  UIManager,
  View,
  type ViewStyle,
} from "react-native";
import type {
  RecommendedReplyTone,
  ReplyTone,
  SuggestedReply,
  ToneOption,
  VibeCheck,
} from "../../types/wingr";

const COLORS = {
  blue: "#1970FD",
  muted: "#B7B7BE",
  panelRaised: "#151515",
  purple: "#6552FF",
  white: "#F6F7FB",
};

const REPLY_SURFACE_COLORS = {
  blue950: "#172554",
  neutral600: "#525252",
  neutral800: "#262626",
  neutral900: "#171717",
};

// This is the unblurred Figma source layer. The canvas adds three standard
// deviations of transparent space on every side, so the SVG filter has room
// to render the blur while the reply card remains the only clipping boundary.
const REPLY_CARD_BOTTOM_GLOW = {
  ellipse: {
    fill: "#404040",
    height: 38,
    right: -19,
    topAboveCardBottom: 15,
    width: 400,
  },
  filterPadding: 300,
  stdDeviation: 40,
} as const;

const REPLY_CARD_BOTTOM_GLOW_SOURCE_BOTTOM =
  REPLY_CARD_BOTTOM_GLOW.ellipse.height -
  REPLY_CARD_BOTTOM_GLOW.ellipse.topAboveCardBottom;

const REPLY_CARD_BOTTOM_GLOW_CANVAS = {
  bottom:
    -REPLY_CARD_BOTTOM_GLOW_SOURCE_BOTTOM -
    REPLY_CARD_BOTTOM_GLOW.filterPadding,
  height:
    REPLY_CARD_BOTTOM_GLOW.ellipse.height +
    REPLY_CARD_BOTTOM_GLOW.filterPadding * 2,
  right:
    REPLY_CARD_BOTTOM_GLOW.ellipse.right - REPLY_CARD_BOTTOM_GLOW.filterPadding,
  width:
    REPLY_CARD_BOTTOM_GLOW.ellipse.width +
    REPLY_CARD_BOTTOM_GLOW.filterPadding * 2,
  x:
    REPLY_CARD_BOTTOM_GLOW.filterPadding +
    REPLY_CARD_BOTTOM_GLOW.ellipse.width / 2,
  y:
    REPLY_CARD_BOTTOM_GLOW.filterPadding +
    REPLY_CARD_BOTTOM_GLOW.ellipse.height / 2,
} as const;

const TONE_EMOJIS: Record<ReplyTone, string> = {
  playful: "🔥",
  direct: "🎯",
  casualSmallTalk: "😊",
};

const TONE_CHIP_STYLES: Record<
  ReplyTone,
  { backgroundColor: string; borderColor: string }
> = {
  playful: {
    backgroundColor: "rgba(120, 53, 15, 0.5)",
    borderColor: "#78350F",
  },
  direct: {
    backgroundColor: "rgba(30, 58, 138, 0.5)",
    borderColor: "#1E3A8A",
  },
  casualSmallTalk: {
    backgroundColor: "rgba(19, 78, 74, 0.5)",
    borderColor: "#115E59",
  },
};

let hasEnabledAndroidLayoutAnimation = false;

const TONE_OPTIONS: ToneOption[] = [
  { value: "playful", label: "Playful", icon: EmojiFunnyCircle },
  { value: "direct", label: "Direct", icon: FireMinimalistic },
  { value: "casualSmallTalk", label: "Small talk", icon: Waterdrop },
];

type MetricVariant = "interest" | "energy" | "risk" | "move";

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

export function getToneLabel(tone: ReplyTone | RecommendedReplyTone) {
  return (
    TONE_OPTIONS.find((option) => option.value === tone)?.label ?? "Playful"
  );
}

function getConversationEnergyCopy(vibeCheck: VibeCheck) {
  const rawEnergy = vibeCheck.conversationEnergy?.trim() ?? "";
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

  return (
    rawEnergy ||
    "There's some interest here, but the chat needs a sharper reply."
  );
}

export function ScreenshotPickerContent({
  errorMessage,
  onPickScreenshot,
  selectedScreenshotUri,
}: {
  errorMessage?: string | null;
  onPickScreenshot: () => void;
  selectedScreenshotUri?: string | null;
}) {
  const hasImage = Boolean(selectedScreenshotUri?.trim());

  return (
    <View style={styles.uploadContent}>
      <Pressable
        accessibilityLabel={
          hasImage ? "Change screenshot" : "Upload screenshot"
        }
        accessibilityRole="button"
        onPress={onPickScreenshot}
        style={({ pressed }) => [styles.uploadBox, pressed && styles.pressed]}
      >
        {hasImage ? (
          <>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              source={{ uri: selectedScreenshotUri ?? "" }}
              style={styles.uploadImage}
            />
            <View style={styles.uploadOverlay}>
              <Refresh color="#FFFFFF" size={18} />
              <Text style={styles.uploadOverlayText}>Change screenshot</Text>
            </View>
          </>
        ) : (
          <View style={styles.uploadEmpty}>
            <Text style={styles.uploadEmptyTitle}>
              Press to upload screenshot
            </Text>
            <View style={styles.plusBox}>
              <Text style={styles.plusText}>+</Text>
            </View>
          </View>
        )}
      </Pressable>
      {errorMessage ? (
        <Text style={styles.errorText}>{errorMessage}</Text>
      ) : null}
    </View>
  );
}

export function AnalyzingContent({
  selectedScreenshotUri,
}: {
  selectedScreenshotUri?: string | null;
}) {
  const hasImage = Boolean(selectedScreenshotUri?.trim());

  return (
    <View style={styles.analyzingContent}>
      {hasImage ? (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={{ uri: selectedScreenshotUri ?? "" }}
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

export function InlineErrorCard({
  message,
  onPrimaryAction,
  onSecondaryAction,
  primaryLabel = "Try again",
  secondaryLabel,
}: {
  message: string;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.inlineErrorTitle}>Something went wrong</Text>
      <Text style={styles.inlineErrorMessage}>{message}</Text>
      <View style={styles.inlineErrorActions}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onPrimaryAction}
          style={styles.inlinePrimaryButton}
        >
          <Text style={styles.inlineButtonText}>{primaryLabel}</Text>
        </TouchableOpacity>
        {secondaryLabel && onSecondaryAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onSecondaryAction}
            style={styles.inlineSecondaryButton}
          >
            <Text style={styles.inlineButtonText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export type VibeCheckCardPresentation = "default" | "inlineExpandable";

export function VibeCheckCard({
  vibeCheck,
  presentation = "default",
}: {
  vibeCheck: VibeCheck;
  presentation?: VibeCheckCardPresentation;
}) {
  if (presentation === "inlineExpandable") {
    return <InlineExpandableVibeCheckCard vibeCheck={vibeCheck} />;
  }

  return (
    <View style={styles.vibeCard}>
      <Text style={styles.vibeCardTitle}>Vibe check</Text>
      <Text style={styles.vibeSummaryText}>
        {vibeCheck.summary || "Wingr read the vibe."}
      </Text>
      <VibeMetric
        icon={Heart}
        label="Their interest"
        value={vibeCheck.interestLevel || "Unclear"}
        variant="interest"
        withMeter
      />
      <VibeMetric
        icon={Bolt}
        label="Conversation energy"
        value={getConversationEnergyCopy(vibeCheck)}
        variant="energy"
      />
      <VibeMetric
        icon={ChatRound}
        label="Best tone"
        value={getToneLabel(vibeCheck.bestTone)}
        variant="move"
      />
      <VibeMetric
        icon={ShieldWarning}
        isLast
        label="Risk"
        value={vibeCheck.risk || "Keep it natural"}
        variant="risk"
      />
    </View>
  );
}

function InlineExpandableVibeCheckCard({
  vibeCheck,
}: {
  vibeCheck: VibeCheck;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    if (
      Platform.OS === "android" &&
      !hasEnabledAndroidLayoutAnimation &&
      UIManager.setLayoutAnimationEnabledExperimental
    ) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
      hasEnabledAndroidLayoutAnimation = true;
    }

    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        300,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.scaleXY,
      ),
    );
    setIsExpanded((current) => !current);
  };

  return (
    <GlassMaterialCard
      materialId="inline-vibe-check"
      contentStyle={styles.inlineVibeCardContent}
    >
      <View style={styles.inlineVibeHeader}>
        <View style={styles.inlineVibeEmojiChip}>
          <Text style={styles.inlineVibeEmoji}>👀</Text>
        </View>
        <Text style={styles.inlineVibeTitle}>Vibe Check</Text>
      </View>
      <Text style={styles.inlineVibeSummary}>
        {vibeCheck.summary || "Wingr read the vibe."}
      </Text>

      {isExpanded ? (
        <View style={styles.inlineVibeMetrics}>
          <VibeMetric
            icon={Heart}
            label="Their interest"
            value={vibeCheck.interestLevel || "Unclear"}
            variant="interest"
            withMeter
          />
          <VibeMetric
            icon={Bolt}
            label="Conversation energy"
            value={getConversationEnergyCopy(vibeCheck)}
            variant="energy"
          />
          <VibeMetric
            icon={ShieldWarning}
            label="Risk"
            value={vibeCheck.risk || "Keep it natural"}
            variant="risk"
          />
          <VibeMetric
            icon={StarsMinimalistic}
            isLast
            label="Best move"
            value={`${getToneLabel(vibeCheck.bestTone)} reply`}
            variant="move"
          />
        </View>
      ) : null}

      <Pressable
        accessibilityLabel={
          isExpanded ? "Hide vibe check breakdown" : "Show vibe check breakdown"
        }
        accessibilityRole="button"
        onPress={toggleExpanded}
        style={styles.inlineVibeAction}
      >
        <Text style={styles.inlineVibeActionText}>
          {isExpanded ? "See Less" : "See Breakdown"}
        </Text>
        <AltArrowDown
          color="#D6D6DB"
          size={16}
          style={isExpanded ? styles.inlineVibeChevronUp : undefined}
        />
      </Pressable>
    </GlassMaterialCard>
  );
}

function VibeMetric({
  icon,
  isLast,
  label,
  value,
  variant,
  withMeter,
}: {
  icon: SolarIcon;
  isLast?: boolean;
  label: string;
  value: string;
  variant: MetricVariant;
  withMeter?: boolean;
}) {
  const config = METRIC_VARIANTS[variant];
  const Icon = icon;

  return (
    <View style={[styles.metricRow, isLast && styles.metricRowLast]}>
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
              id={`blobBlurTopLeft-${variant}`}
              width="280%"
              x="-90%"
              y="-90%"
            >
              <FeGaussianBlur stdDeviation="14" />
            </Filter>
            <Filter
              height="280%"
              id={`blobBlurTopRight-${variant}`}
              width="280%"
              x="-90%"
              y="-90%"
            >
              <FeGaussianBlur stdDeviation="14" />
            </Filter>
            <Filter
              height="280%"
              id={`blobBlurBottom-${variant}`}
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
            filter={`url(#blobBlurTopLeft-${variant})`}
            rx="20"
            ry="8"
          />
          <Ellipse
            cx="31"
            cy="10"
            fill={config.blobColors[1]}
            filter={`url(#blobBlurTopRight-${variant})`}
            rx="20"
            ry="8"
          />
          <Ellipse
            cx="15"
            cy="33"
            fill={config.blobColors[2]}
            filter={`url(#blobBlurBottom-${variant})`}
            rx="20"
            ry="8"
          />
        </Svg>
        <View style={styles.metricIconForeground}>
          <Icon color={config.iconColor} size={20} />
        </View>
      </View>
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

export type RepliesContentPresentation = "default" | "mainFeed";

type RepliesContentProps = {
  isGenerating: boolean;
  lastGeneratedReplyId?: string | null;
  maxReplies?: number;
  onContentLayout?: (layout: { y: number }) => void;
  onRefreshReplies: () => Promise<boolean>;
  onReplyLayout?: (layout: { height: number; y: number }) => void;
  onToneChange: (tone: ReplyTone) => Promise<boolean>;
  replies?: SuggestedReply[];
  selectedTone: ReplyTone;
  presentation?: RepliesContentPresentation;
  showControls?: boolean;
  showTypingIndicator?: boolean;
};

export function RepliesContent({
  isGenerating,
  lastGeneratedReplyId,
  onContentLayout,
  onRefreshReplies,
  onReplyLayout,
  onToneChange,
  replies = [],
  selectedTone,
  presentation = "default",
  showControls = true,
  showTypingIndicator = false,
  maxReplies,
}: RepliesContentProps) {
  const [copiedReplyId, setCopiedReplyId] = useState<string | null>(null);
  const displayedReplies =
    typeof maxReplies === "number" ? replies.slice(0, maxReplies) : replies;

  const handleReplyLayout = (event: LayoutChangeEvent) => {
    onReplyLayout?.(event.nativeEvent.layout);
  };

  const handleContentLayout = (event: LayoutChangeEvent) => {
    onContentLayout?.(event.nativeEvent.layout);
  };

  const copyReply = async (reply: SuggestedReply) => {
    const didCopy = await Clipboard.setStringAsync(reply.text || "");

    if (didCopy) {
      setCopiedReplyId(reply.id);
    }
  };

  return (
    <View
      onLayout={handleContentLayout}
      style={[
        styles.repliesContent,
        presentation === "mainFeed" && styles.mainFeedRepliesContent,
      ]}
    >
      {showControls ? (
        <ReplyActionBar
          isGenerating={isGenerating}
          onRefreshReplies={onRefreshReplies}
          onReplyGenerated={() => setCopiedReplyId(null)}
          onToneChange={onToneChange}
          selectedTone={selectedTone}
          variant="inline"
        />
      ) : null}

      {displayedReplies.map((reply, index) => (
        <ReplyCard
          animateEntry={reply.id === lastGeneratedReplyId}
          copied={copiedReplyId === reply.id}
          key={reply.id}
          onCopy={() => copyReply(reply)}
          onLayout={
            reply.id === lastGeneratedReplyId ? handleReplyLayout : undefined
          }
          recommended={index === 0}
          presentation={presentation}
          reply={reply}
        />
      ))}

      {showTypingIndicator && isGenerating ? (
        <TypingBubble
          onLayout={handleReplyLayout}
          presentation={presentation}
        />
      ) : null}
    </View>
  );
}

export type ReplyActionBarProps = {
  isGenerating: boolean;
  onRefreshReplies: () => Promise<boolean>;
  onReplyGenerated?: () => void;
  onToneChange: (tone: ReplyTone) => Promise<boolean>;
  selectedTone: ReplyTone;
  variant?: "inline" | "sticky";
};

export function ReplyActionBar({
  isGenerating,
  onRefreshReplies,
  onReplyGenerated,
  onToneChange,
  selectedTone,
  variant = "sticky",
}: ReplyActionBarProps) {
  const [isToneSheetOpen, setIsToneSheetOpen] = useState(false);
  const isSticky = variant === "sticky";

  const refreshReplies = async () => {
    const succeeded = await onRefreshReplies();
    if (succeeded) onReplyGenerated?.();
  };

  const changeTone = async (tone: ReplyTone) => {
    setIsToneSheetOpen(false);
    const succeeded = await onToneChange(tone);
    if (succeeded) onReplyGenerated?.();
  };

  return (
    <View
      style={[
        styles.repliesControlsRow,
        isSticky && styles.stickyReplyActionBar,
      ]}
    >
      <TouchableOpacity
        accessibilityLabel={
          isGenerating
            ? "Generating a new reply"
            : isSticky
              ? "Get new reply"
              : "New reply"
        }
        accessibilityRole="button"
        disabled={isGenerating}
        onPress={() => {
          void refreshReplies();
        }}
        style={[
          isSticky ? styles.stickyNewRepliesButton : styles.newRepliesButton,
          isGenerating && styles.disabled,
        ]}
      >
        {isGenerating ? (
          <ActivityIndicator color={COLORS.white} size="small" />
        ) : (
          <>
            <Refresh color={COLORS.white} size={16} />
            <Text
              style={
                isSticky
                  ? styles.stickyNewRepliesButtonText
                  : styles.newRepliesButtonText
              }
            >
              {isSticky ? "Get New Reply" : "New reply"}
            </Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityLabel={`Choose reply tone, currently ${getToneLabel(selectedTone)}`}
        accessibilityRole="button"
        disabled={isGenerating}
        onPress={() => setIsToneSheetOpen(true)}
        style={[
          styles.toneSelector,
          isSticky && styles.stickyToneSelector,
          isGenerating && styles.disabled,
        ]}
      >
        {isSticky ? (
          <Text style={styles.stickyToneEmoji}>
            {TONE_EMOJIS[selectedTone]}
          </Text>
        ) : (
          <StarsMinimalistic color="#D6D6DB" size={14} />
        )}
        <Text
          numberOfLines={1}
          style={[
            styles.toneSelectorText,
            isSticky && styles.stickyToneSelectorText,
          ]}
        >
          {getToneLabel(selectedTone)}
        </Text>
        <AltArrowDown color="#D6D6DB" size={16} />
      </TouchableOpacity>
      <ToneBottomSheet
        onClose={() => setIsToneSheetOpen(false)}
        onSelect={(tone) => {
          void changeTone(tone);
        }}
        selectedTone={selectedTone}
        visible={isToneSheetOpen}
      />
    </View>
  );
}

function ReplyCard({
  animateEntry = false,
  copied,
  onCopy,
  onLayout,
  presentation = "default",
  recommended,
  reply,
}: {
  animateEntry?: boolean;
  copied: boolean;
  onCopy: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  presentation?: RepliesContentPresentation;
  recommended: boolean;
  reply: SuggestedReply;
}) {
  const entryOpacity = useRef(new Animated.Value(animateEntry ? 0 : 1)).current;
  const entryTranslateY = useRef(
    new Animated.Value(animateEntry ? 6 : 0),
  ).current;

  useEffect(() => {
    if (!animateEntry) {
      entryOpacity.setValue(1);
      entryTranslateY.setValue(0);
      return;
    }

    entryOpacity.setValue(0);
    entryTranslateY.setValue(6);
    const animation = Animated.parallel([
      Animated.timing(entryOpacity, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(entryTranslateY, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [animateEntry, entryOpacity, entryTranslateY]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        presentation === "mainFeed" && styles.mainFeedReplyCardWrapper,
        {
          opacity: entryOpacity,
          transform: [{ translateY: entryTranslateY }],
        },
      ]}
    >
      {presentation === "mainFeed" ? (
        <MainFeedReplyCard copied={copied} onCopy={onCopy} reply={reply} />
      ) : (
        <View
          style={[styles.replyCard, recommended && styles.recommendedReplyCard]}
        >
          {recommended ? (
            <View style={styles.recommendedBadge}>
              <StarsMinimalistic color="#4D8CFF" size={14} />
              <Text style={styles.recommendedBadgeText}>Recommended</Text>
            </View>
          ) : null}
          <View style={styles.replyCardBody}>
            <Text style={styles.replyText}>
              {reply.text || "Reply unavailable"}
            </Text>
            {recommended && reply.whyItWorks ? (
              <View style={styles.whyItWorks}>
                <Text style={styles.whyItWorksTitle}>Why it works:</Text>
                <Text style={styles.whyItWorksText}>{reply.whyItWorks}</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={onCopy}
            style={styles.copyButton}
          >
            {copied ? (
              <CheckCircle color="#FFFFFF" size={16} />
            ) : (
              <Copy color="#FFFFFF" size={16} />
            )}
            <Text style={styles.copyButtonText}>
              {copied ? "Copied" : "Copy"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

function MainFeedReplyCard({
  copied,
  onCopy,
  reply,
}: {
  copied: boolean;
  onCopy: () => void;
  reply: SuggestedReply;
}) {
  const toneChipStyle = TONE_CHIP_STYLES[reply.tone];

  return (
    <GlassMaterialCard
      materialId={`reply-${reply.id}`}
      contentStyle={styles.mainFeedReplyContent}
    >
      <View style={styles.mainFeedReplyHeader}>
        <View style={[styles.mainFeedToneChip, toneChipStyle]}>
          <Text style={styles.mainFeedToneEmoji}>{TONE_EMOJIS[reply.tone]}</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
          accessibilityRole="button"
          onPress={onCopy}
          style={styles.mainFeedCopyButton}
        >
          {copied ? (
            <CheckCircle color="#D6D6DB" size={16} />
          ) : (
            <Copy color="#D6D6DB" size={16} />
          )}
          <Text style={styles.mainFeedCopyButtonText}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.mainFeedReplyText}>
        {reply.text || "Reply unavailable"}
      </Text>
    </GlassMaterialCard>
  );
}

function GlassMaterialCard({
  children,
  contentStyle,
  materialId,
}: {
  children: ReactNode;
  contentStyle: StyleProp<ViewStyle>;
  materialId: string;
}) {
  const sanitizedId = materialId.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = useRef(`glass-card-stroke-${sanitizedId}`).current;
  const bottomGlowId = useRef(`glass-card-bottom-glow-${sanitizedId}`).current;

  return (
    <View style={styles.mainFeedReplyCardOuter}>
      <View style={styles.mainFeedReplyCard}>
        <Svg
          height={REPLY_CARD_BOTTOM_GLOW_CANVAS.height}
          pointerEvents="none"
          style={styles.mainFeedReplyBottomGlow}
          width={REPLY_CARD_BOTTOM_GLOW_CANVAS.width}
        >
          <Defs>
            <Filter
              filterUnits="userSpaceOnUse"
              height={REPLY_CARD_BOTTOM_GLOW_CANVAS.height}
              id={bottomGlowId}
              primitiveUnits="userSpaceOnUse"
              width={REPLY_CARD_BOTTOM_GLOW_CANVAS.width}
              x={0}
              y={0}
            >
              <FeGaussianBlur
                stdDeviation={REPLY_CARD_BOTTOM_GLOW.stdDeviation}
              />
            </Filter>
          </Defs>
          <Ellipse
            cx={REPLY_CARD_BOTTOM_GLOW_CANVAS.x}
            cy={REPLY_CARD_BOTTOM_GLOW_CANVAS.y}
            fill={REPLY_CARD_BOTTOM_GLOW.ellipse.fill}
            filter={`url(#${bottomGlowId})`}
            rx={REPLY_CARD_BOTTOM_GLOW.ellipse.width / 2}
            ry={REPLY_CARD_BOTTOM_GLOW.ellipse.height / 2}
          />
        </Svg>
        <BlurView
          blurReductionFactor={1}
          experimentalBlurMethod={
            Platform.OS === "android" ? "dimezisBlurView" : undefined
          }
          intensity={26}
          pointerEvents="none"
          style={styles.mainFeedReplyBlur}
          tint="dark"
        />
        <View pointerEvents="none" style={styles.mainFeedReplyTint} />
        <Svg
          height="100%"
          pointerEvents="none"
          style={styles.mainFeedGradientBorder}
          width="100%"
        >
          <Defs>
            <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.23" />
              <Stop offset="48%" stopColor="#FFFFFF" stopOpacity="0.11" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.02" />
            </LinearGradient>
          </Defs>
          <Rect
            fill="none"
            height="99.5%"
            rx="14"
            ry="14"
            stroke={`url(#${gradientId})`}
            strokeWidth="1"
            width="99.5%"
            x="0.5"
            y="0.5"
          />
        </Svg>

        <View style={contentStyle}>{children}</View>
      </View>
    </View>
  );
}

function TypingBubble({
  onLayout,
  presentation = "default",
}: {
  onLayout: (event: LayoutChangeEvent) => void;
  presentation?: RepliesContentPresentation;
}) {
  return (
    <View
      accessible
      accessibilityLabel="Wingr is typing"
      onLayout={onLayout}
      style={[
        styles.typingBubble,
        presentation === "mainFeed" && styles.mainFeedTypingBubble,
      ]}
    >
      <TypingDot delay={0} />
      <TypingDot delay={120} />
      <TypingDot delay={240} />
    </View>
  );
}

function TypingDot({ delay }: { delay: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const activeDuration = 300;
    const cycleDuration = 900;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          duration: activeDuration / 2,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: activeDuration / 2,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.delay(cycleDuration - delay - activeDuration),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        styles.typingDot,
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.42, 1],
          }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [2, -2],
              }),
            },
          ],
        },
      ]}
    />
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
      <Pressable onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetPanel}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose tone</Text>
          <View style={styles.toneOptions}>
            {TONE_OPTIONS.map((option) => {
              const selected = option.value === selectedTone;
              const ToneIcon = option.icon;

              return (
                <TouchableOpacity
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
                    <ToneIcon
                      color={selected ? COLORS.blue : "#D6D6DB"}
                      size={20}
                    />
                    <Text
                      style={[
                        styles.toneOptionText,
                        selected && styles.toneOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </View>
                  {selected ? (
                    <CheckCircle color={COLORS.blue} size={21} />
                  ) : null}
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
  analyzingContent: {
    alignItems: "center",
    gap: 14,
    justifyContent: "center",
  },
  analyzingImage: {
    backgroundColor: "#24242A",
    borderRadius: 18,
    height: 220,
    opacity: 0.68,
    width: 154,
  },
  analyzingText: {
    color: COLORS.muted,
    fontFamily: "ClashGroteskRegular",
    fontSize: 15,
    lineHeight: 20,
    maxWidth: 280,
    textAlign: "center",
  },
  analyzingTitle: {
    color: COLORS.white,
    fontFamily: "ClashDisplay",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 28,
    textAlign: "center",
  },
  copyButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flexDirection: "row",
    gap: 10,
    height: 48,
    justifyContent: "center",
    marginTop: 22,
  },
  copyButtonText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 17,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.65,
  },
  errorText: {
    color: "#FF747D",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center",
  },
  glowIconContainer: {
    borderRadius: 10,
    height: 34,
    overflow: "hidden",
    position: "relative",
    width: 34,
  },
  glowSvg: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  inlineButtonText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "600",
  },
  inlineError: {
    backgroundColor: "#181818",
    borderColor: "#3A3A3F",
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  inlineErrorActions: {
    flexDirection: "row",
    gap: 10,
  },
  inlineErrorMessage: {
    color: "#D7D7D7",
    fontFamily: "ClashGroteskRegular",
    fontSize: 15,
    lineHeight: 20,
  },
  inlineErrorTitle: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 20,
    fontWeight: "700",
  },
  inlinePrimaryButton: {
    alignItems: "center",
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  inlineSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#454545",
    borderRadius: 999,
    flex: 1,
    height: 44,
    justifyContent: "center",
  },
  inlineVibeAction: {
    alignItems: "center",
    borderColor: "#8A8A8A",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    height: 25,
    justifyContent: "center",
    marginTop: 16,
  },
  inlineVibeActionText: {
    color: "#B8B8B8",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    marginRight: 6,
  },
  inlineVibeCardContent: {
    padding: 16,
    position: "relative",
    zIndex: 5,
  },
  inlineVibeChevronUp: {
    transform: [{ rotate: "180deg" }],
  },
  inlineVibeEmoji: {
    fontSize: 18,
    lineHeight: 21,
  },
  inlineVibeEmojiChip: {
    alignItems: "center",
    backgroundColor: "rgba(30, 58, 138, 0.5)",
    borderColor: "#1E3A8A",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    width: 34,
  },
  inlineVibeHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 28,
    justifyContent: "center",
    position: "relative",
  },
  inlineVibeMetrics: {
    borderTopColor: "#29292E",
    borderTopWidth: 1,
    marginTop: 16,
  },
  inlineVibeSummary: {
    color: "#D6D6DB",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    lineHeight: 18,
    marginTop: 16,
  },
  inlineVibeTitle: {
    color: COLORS.blue,
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  meterFill: {
    backgroundColor: COLORS.purple,
    borderRadius: 999,
    height: "100%",
    width: "50%",
  },
  meterTrack: {
    backgroundColor: "#56565C",
    borderRadius: 999,
    height: 6,
    overflow: "hidden",
    width: 110,
  },
  metricCopy: {
    flex: 1,
  },
  metricIconForeground: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  metricLabel: {
    color: "#C9C9CF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
    lineHeight: 17,
  },
  metricRow: {
    alignItems: "center",
    borderBottomColor: "#29292E",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 67,
    paddingVertical: 8,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  metricValue: {
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  metricValueBody: {
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "600",
  },
  mainFeedCopyButton: {
    alignItems: "center",
    backgroundColor: "#404040",
    borderColor: "#525252",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 25,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  mainFeedCopyButtonText: {
    color: "#D6D6DB",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    fontWeight: "600",
  },
  mainFeedGradientBorder: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 4,
  },
  mainFeedRepliesContent: {
    gap: 8,
  },
  mainFeedReplyCard: {
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
    zIndex: 1,
  },
  mainFeedReplyBottomGlow: {
    bottom: REPLY_CARD_BOTTOM_GLOW_CANVAS.bottom,
    height: REPLY_CARD_BOTTOM_GLOW_CANVAS.height,
    position: "absolute",
    right: REPLY_CARD_BOTTOM_GLOW_CANVAS.right,
    width: REPLY_CARD_BOTTOM_GLOW_CANVAS.width,
    zIndex: 3,
  },
  mainFeedReplyBlur: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  mainFeedReplyContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    position: "relative",
    zIndex: 5,
  },
  mainFeedReplyCardOuter: {
    borderRadius: 14,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  mainFeedReplyCardWrapper: {
    position: "relative",
  },
  mainFeedReplyHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 28,
    justifyContent: "space-between",
  },
  mainFeedReplyText: {
    color: "#F6F7FB",
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: 16,
  },
  mainFeedReplyTint: {
    backgroundColor: REPLY_SURFACE_COLORS.neutral900,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 2,
  },
  mainFeedToneChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 34,
  },
  mainFeedToneEmoji: {
    fontSize: 18,
    lineHeight: 18,
  },
  mainFeedTypingBubble: {
    backgroundColor: REPLY_SURFACE_COLORS.neutral900,
    borderColor: REPLY_SURFACE_COLORS.neutral800,
    height: 36,
    minWidth: 62,
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
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "600",
  },
  plusBox: {
    alignItems: "center",
    borderColor: "#FFFFFF",
    borderRadius: 7,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  plusText: {
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.86,
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
    fontFamily: "ClashGroteskRegular",
    fontSize: 12,
  },
  recommendedReplyCard: {
    backgroundColor: "#0C111D",
    borderColor: COLORS.blue,
  },
  repliesContent: {
    gap: 14,
    width: "100%",
  },
  repliesControlsRow: {
    flexDirection: "row",
    gap: 10,
  },
  repliesLoadingCard: {
    alignItems: "center",
    backgroundColor: "#151515",
    borderRadius: 14,
    gap: 12,
    minHeight: 160,
    justifyContent: "center",
  },
  repliesLoadingText: {
    color: "#D6D6DB",
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "600",
  },
  replyCard: {
    backgroundColor: "#151515",
    borderColor: "#2B2B2F",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  replyCardBody: {
    gap: 18,
    paddingHorizontal: 22,
    paddingTop: 20,
  },
  replyText: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 23,
    fontWeight: "700",
    lineHeight: 30,
  },
  sheetBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "#4A4A50",
    borderRadius: 999,
    height: 5,
    width: 48,
  },
  sheetPanel: {
    backgroundColor: "#111113",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    gap: 18,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  stickyNewRepliesButton: {
    alignItems: "center",
    backgroundColor: "#404040",
    borderColor: REPLY_SURFACE_COLORS.neutral600,
    borderWidth: 1,
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    height: 37,
    justifyContent: "center",
  },
  stickyNewRepliesButtonText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "600",
  },
  stickyReplyActionBar: {
    alignItems: "center",
  },
  stickyToneEmoji: {
    fontSize: 18,
    lineHeight: 18,
  },
  stickyToneSelector: {
    backgroundColor: "transparent",
    borderColor: "#A3A3A3",
    height: 37,
    paddingHorizontal: 8,
    width: 102,
  },
  stickyToneSelectorText: {
    color: "#A3A3A3",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    lineHeight: 17,
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
  },
  toneOptionLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  toneOptionSelected: {
    backgroundColor: "#0C1427",
    borderColor: COLORS.blue,
  },
  toneOptionText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 18,
    fontWeight: "600",
  },
  toneOptionTextSelected: {
    color: "#6EA0FF",
  },
  toneOptions: {
    gap: 12,
  },
  toneSelector: {
    alignItems: "center",
    borderColor: COLORS.muted,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 16,
    width: 160,
  },
  toneSelectorText: {
    color: "#D6D6DB",
    flexShrink: 1,
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
  },
  typingBubble: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#151515",
    borderColor: "#2B2B2F",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 38,
    justifyContent: "center",
    minWidth: 64,
    paddingHorizontal: 14,
  },
  typingDot: {
    backgroundColor: "#C7CAD2",
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  uploadBox: {
    alignItems: "center",
    alignSelf: "center",
    aspectRatio: 0.68,
    backgroundColor: "#171717",
    borderColor: "#5D5D5D",
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
    width: "72%",
  },
  uploadContent: {
    alignItems: "center",
    gap: 10,
    width: "100%",
  },
  uploadEmpty: {
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 20,
  },
  uploadEmptyTitle: {
    color: "#D8D8D8",
    fontFamily: "ClashGrotesk",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  uploadImage: {
    height: "100%",
    width: "100%",
  },
  uploadOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.48)",
    bottom: 0,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    left: 0,
    paddingVertical: 14,
    position: "absolute",
    right: 0,
  },
  uploadOverlayText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "600",
  },
  vibeCard: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 12,
    padding: 10,
  },
  vibeCardTitle: {
    color: COLORS.blue,
    fontFamily: "ClashDisplay",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
  },
  vibeSummaryText: {
    color: COLORS.white,
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
    marginBottom: 6,
  },
  whyItWorks: {
    gap: 2,
  },
  whyItWorksText: {
    color: "#D6D6DB",
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
  },
  whyItWorksTitle: {
    color: "#D6D6DB",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "600",
  },
});
