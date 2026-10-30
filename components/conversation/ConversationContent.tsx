import * as Clipboard from "expo-clipboard";
import { BlurView } from "expo-blur";
import { posthog } from "../../lib/posthog";
import { BottomSheet } from "../BottomSheet";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Reanimated, {
  Easing as ReanimatedEasing,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  AltArrowDown,
  Bolt,
  CheckCircle,
  ChatRound,
  Copy,
  Heart,
  Refresh,
  Repeat,
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
  Animated,
  Easing,
  Image,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import type {
  RecommendedReplyTone,
  ReplyTone,
  SuggestedReply,
  ToneOption,
  VibeCheck,
} from "../../types/wingr";
import {
  colors,
  fontFamilies,
  surfaces,
  toneStyles,
  typography,
} from "../../theme";
import { pressHaptic, successHaptic, tapHaptic } from "../../lib/haptics";
import { GlowEllipse } from "../GlowEllipse";
import { WingrTypingBubble } from "../WingrTypingBubble";

// Vertical radius of the reply-card glow ellipse (Figma: 40 tall).
const GLOW_RY = 20;

const COLORS = {
  blue: "#1970FD",
  muted: "#B7B7BE",
  panelRaised: "#151515",
  purple: "#6552FF",
  white: "#F6F7FB",
};

const REPLY_CARD_PRESS_SCALE = 0.985;
const REPLY_CARD_PRESS_STROKE_OPACITY = 0.55;
// Figma: the pill's two controls are 40 px high with a 20 px radius; their
// widths follow their content.
const STICKY_ACTION_BUTTON = {
  height: 40,
  newReplyMinWidth: 160,
  radius: 20,
} as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTouchableOpacity =
  Animated.createAnimatedComponent(TouchableOpacity);
const ReanimatedPressable = Reanimated.createAnimatedComponent(Pressable);

const VIBE_CHECK_LAYOUT_TRANSITION = LinearTransition.duration(220).easing(
  ReanimatedEasing.out(ReanimatedEasing.cubic),
);
const VIBE_CHECK_METRICS_ENTERING = FadeInDown.duration(200)
  .delay(20)
  .easing(ReanimatedEasing.out(ReanimatedEasing.cubic));
const VIBE_CHECK_METRICS_EXITING = FadeOut.duration(120).easing(
  ReanimatedEasing.out(ReanimatedEasing.cubic),
);

const TONE_EMOJIS: Record<ReplyTone, string> = {
  playful: "🔥",
  direct: "🎯",
  casualSmallTalk: "😊",
};

const TONE_OPTIONS: ToneOption[] = [
  { value: "playful", label: "Playful", emoji: TONE_EMOJIS.playful },
  { value: "direct", label: "Direct", emoji: TONE_EMOJIS.direct },
  {
    value: "casualSmallTalk",
    label: "Casual",
    emoji: TONE_EMOJIS.casualSmallTalk,
  },
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

const INLINE_VIBE_METRIC_VARIANTS: Record<
  MetricVariant,
  {
    backgroundColor: string;
    borderColor: string;
    iconBackgroundColor: string;
    iconColor: string;
    labelColor: string;
    valueColor: string;
  }
> = {
  interest: {
    backgroundColor: "rgba(30, 27, 75, 0.3)",
    borderColor: "rgba(30, 58, 138, 0.5)",
    iconBackgroundColor: "#1D4ED8",
    iconColor: "#E0E7FF",
    labelColor: "#E0E7FF",
    valueColor: colors.blue500,
  },
  energy: {
    backgroundColor: "rgba(69, 26, 3, 0.3)",
    borderColor: "rgba(120, 53, 15, 0.5)",
    iconBackgroundColor: "#B45309",
    iconColor: "#FEF3C7",
    labelColor: "#FEF3C7",
    valueColor: colors.amber500,
  },
  risk: {
    backgroundColor: "rgba(69, 10, 10, 0.3)",
    borderColor: "rgba(127, 29, 29, 0.5)",
    iconBackgroundColor: "#B91C1C",
    iconColor: "#FEE2E2",
    labelColor: "#FEE2E2",
    valueColor: colors.red500,
  },
  move: {
    backgroundColor: "rgba(4, 47, 46, 0.3)",
    borderColor: "rgba(19, 78, 74, 0.5)",
    iconBackgroundColor: "#0F766E",
    iconColor: "#CCFBF1",
    labelColor: "#CCFBF1",
    valueColor: colors.teal500,
  },
};

const INTEREST_METER_PROGRESS: Record<VibeCheck["interestLevel"], number> = {
  High: 1,
  Low: 0.2,
  Medium: 0.5,
  Unclear: 0.5,
};

export function getToneLabel(tone: ReplyTone | RecommendedReplyTone) {
  return (
    TONE_OPTIONS.find((option) => option.value === tone)?.label ?? "Playful"
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

export function InlineErrorCard({
  title = "Something went wrong",
  message,
  onPrimaryAction,
  onSecondaryAction,
  primaryLabel = "Try again",
  secondaryLabel,
}: {
  title?: string;
  message: string;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  return (
    <View style={styles.inlineError}>
      <Text style={styles.inlineErrorTitle}>{title}</Text>
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
  defaultExpanded = false,
  vibeCheck,
  presentation = "default",
}: {
  // Starts the inline card open (the dev preview uses it to show that state).
  defaultExpanded?: boolean;
  vibeCheck: VibeCheck;
  presentation?: VibeCheckCardPresentation;
}) {
  if (presentation === "inlineExpandable") {
    return (
      <InlineExpandableVibeCheckCard
        defaultExpanded={defaultExpanded}
        vibeCheck={vibeCheck}
      />
    );
  }

  return (
    <View style={styles.vibeCard}>
      <Text style={styles.vibeCardTitle}>Vibe check</Text>
      <Text style={styles.vibeSummaryText}>
        {vibeCheck.summary || "WiNGR read the vibe."}
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
        value={vibeCheck.conversationEnergy}
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
  defaultExpanded,
  vibeCheck,
}: {
  defaultExpanded: boolean;
  vibeCheck: VibeCheck;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const chevronRotation = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const animatedChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));
  const animatedPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  useEffect(() => {
    chevronRotation.value = withTiming(isExpanded ? 180 : 0, {
      duration: 180,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
    });
  }, [chevronRotation, isExpanded]);

  // The little press-in is a quick pulse that plays on a real tap (expand or
  // collapse), not when a finger lands to scroll.
  const toggleExpanded = () => {
    const easing = ReanimatedEasing.out(ReanimatedEasing.cubic);
    pressScale.value = withSequence(
      withTiming(REPLY_CARD_PRESS_SCALE, { duration: 80, easing }),
      withTiming(1, { duration: 140, easing }),
    );
    setIsExpanded((current) => !current);
  };

  return (
    <ReanimatedPressable
      accessibilityLabel={
        isExpanded ? "Hide vibe check breakdown" : "Show vibe check breakdown"
      }
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      layout={VIBE_CHECK_LAYOUT_TRANSITION}
      onPress={toggleExpanded}
      style={[styles.inlineVibeCardOuter, animatedPressStyle]}
    >
      <Reanimated.View
        layout={VIBE_CHECK_LAYOUT_TRANSITION}
        style={styles.inlineVibeCard}
      >
        {isExpanded ? (
          <GlowEllipse
            blur={75}
            fill={colors.indigo950}
            opacity={0.3}
            rotation={-0.7}
            rx={232.5}
            ry={182}
            style={styles.inlineVibeExpandedGlow}
          />
        ) : (
          <GlowEllipse
            blur={50}
            fill={colors.indigo600}
            rx={232.5}
            ry={11}
            style={styles.inlineVibeBottomGlow}
          />
        )}
        <View style={styles.inlineVibeCardContent}>
          <View style={styles.inlineVibeHeader}>
            <View style={styles.inlineVibeEmojiChip}>
              <Text style={styles.inlineVibeEmoji}>👀</Text>
            </View>
            <Text style={styles.inlineVibeTitle}>Vibe Check</Text>
            <View style={styles.inlineVibeChevronChip}>
              <Reanimated.View
                style={[styles.inlineVibeChevronIcon, animatedChevronStyle]}
              >
                <AltArrowDown color="#E0E7FF" size={18} />
              </Reanimated.View>
            </View>
          </View>
          {/* One truncated line while closed; the whole analysis once open. */}
          <Text
            ellipsizeMode="tail"
            numberOfLines={isExpanded ? undefined : 1}
            style={styles.inlineVibeSummary}
          >
            {vibeCheck.summary || "WiNGR read the vibe."}
          </Text>

          {isExpanded ? (
            <Reanimated.View
              entering={VIBE_CHECK_METRICS_ENTERING}
              exiting={VIBE_CHECK_METRICS_EXITING}
            >
              <View style={styles.inlineVibeMetrics}>
                <InlineVibeMetric
                  icon={Heart}
                  label="Their interest"
                  value={vibeCheck.interestLevel || "Unclear"}
                  variant="interest"
                  withMeter
                />
                <InlineVibeMetric
                  icon={Bolt}
                  label="Conversation energy"
                  value={vibeCheck.conversationEnergy}
                  variant="energy"
                />
                <InlineVibeMetric
                  icon={ShieldWarning}
                  label="Risk"
                  value={vibeCheck.risk || "Keep it natural"}
                  variant="risk"
                />
                <InlineVibeMetric
                  icon={StarsMinimalistic}
                  label="Best move"
                  value={`${getToneLabel(vibeCheck.bestTone)} reply`}
                  variant="move"
                />
              </View>
            </Reanimated.View>
          ) : null}
        </View>
      </Reanimated.View>
    </ReanimatedPressable>
  );
}

function InlineVibeMetric({
  icon,
  label,
  value,
  variant,
  withMeter,
}: {
  icon: SolarIcon;
  label: string;
  value: string;
  variant: MetricVariant;
  withMeter?: boolean;
}) {
  const config = INLINE_VIBE_METRIC_VARIANTS[variant];
  const Icon = icon;

  return (
    <View
      style={[
        styles.inlineVibeMetric,
        {
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
        },
      ]}
    >
      <View style={styles.inlineVibeMetricHeader}>
        <View
          style={[
            styles.inlineVibeMetricIcon,
            { backgroundColor: config.iconBackgroundColor },
          ]}
        >
          <Icon color={config.iconColor} size={20} />
        </View>
        <View style={styles.inlineVibeMetricCopy}>
          <Text
            style={[styles.inlineVibeMetricLabel, { color: config.labelColor }]}
          >
            {label}
          </Text>
          <Text
            style={[styles.inlineVibeMetricValue, { color: config.valueColor }]}
          >
            {value}
          </Text>
        </View>
      </View>
      {withMeter ? (
        <InlineVibeInterestMeter
          interestLevel={vibeCheckInterestLevel(value)}
        />
      ) : null}
    </View>
  );
}

function vibeCheckInterestLevel(value: string): VibeCheck["interestLevel"] {
  return value === "High" || value === "Low" || value === "Medium"
    ? value
    : "Unclear";
}

function InlineVibeInterestMeter({
  interestLevel,
}: {
  interestLevel: VibeCheck["interestLevel"];
}) {
  const fillWidth = `${INTEREST_METER_PROGRESS[interestLevel] * 100}%`;

  return (
    <View style={styles.inlineVibeMeterTrack}>
      <Svg height="8" width={fillWidth}>
        <Defs>
          <LinearGradient
            id="inline-vibe-interest-meter"
            x1="0%"
            x2="100%"
            y1="0%"
            y2="0%"
          >
            <Stop offset="0%" stopColor="#1D4ED8" />
            <Stop offset="100%" stopColor="#93C5FD" />
          </LinearGradient>
        </Defs>
        <Rect
          fill="url(#inline-vibe-interest-meter)"
          height="8"
          rx="4"
          ry="4"
          width="100%"
        />
      </Svg>
    </View>
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
  const [copyAnimationVersion, setCopyAnimationVersion] = useState(0);
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
      setCopyAnimationVersion((version) => version + 1);
      posthog.capture("reply_copied", { tone: reply.tone });
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
          copyAnimationVersion={copyAnimationVersion}
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
        <WingrTypingBubble onLayout={handleReplyLayout} />
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
  const newReplyPressAnimation = useActionButtonPressAnimation();
  const tonePressAnimation = useActionButtonPressAnimation();

  const refreshReplies = async () => {
    const succeeded = await onRefreshReplies();
    if (succeeded) {
      if (isSticky) successHaptic();
      onReplyGenerated?.();
    }
  };

  const changeTone = async (tone: ReplyTone) => {
    setIsToneSheetOpen(false);
    await onToneChange(tone);
  };

  return (
    <View
      style={[
        styles.repliesControlsRow,
        isSticky && styles.stickyReplyActionBar,
      ]}
    >
      <View style={isSticky ? styles.stickyNewRepliesButtonShadow : undefined}>
        <AnimatedTouchableOpacity
          activeOpacity={0.88}
          accessibilityLabel={
            isGenerating
              ? "Generating a new reply"
              : isSticky
                ? "Get new reply"
                : "New reply"
          }
          accessibilityRole="button"
          disabled={isGenerating}
          hitSlop={isSticky ? 4 : undefined}
          onPress={() => {
            void refreshReplies();
          }}
          onPressIn={
            isSticky
              ? () => {
                  pressHaptic();
                  newReplyPressAnimation.onPressIn();
                }
              : undefined
          }
          onPressOut={isSticky ? newReplyPressAnimation.onPressOut : undefined}
          style={[
            isSticky ? styles.stickyNewRepliesButton : styles.newRepliesButton,
            isGenerating && styles.disabled,
            isSticky && newReplyPressAnimation.style,
          ]}
        >
          {isGenerating ? (
            <ActivityIndicator color="#E0E7FF" size="small" />
          ) : (
            <>
              {isSticky ? (
                <Repeat color={colors.indigo100} size={16} />
              ) : (
                <Refresh color={COLORS.white} size={16} />
              )}
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
        </AnimatedTouchableOpacity>
      </View>
      <View style={isSticky ? styles.stickyToneSelectorShadow : undefined}>
        <AnimatedTouchableOpacity
          activeOpacity={0.88}
          accessibilityLabel={`Choose reply tone, currently ${getToneLabel(selectedTone)}`}
          accessibilityRole="button"
          disabled={isGenerating}
          hitSlop={isSticky ? 4 : undefined}
          onPress={() => setIsToneSheetOpen(true)}
          onPressIn={isSticky ? tonePressAnimation.onPressIn : undefined}
          onPressOut={isSticky ? tonePressAnimation.onPressOut : undefined}
          style={[
            styles.toneSelector,
            isSticky && styles.stickyToneSelector,
            isGenerating && styles.disabled,
            isSticky && tonePressAnimation.style,
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
          <AltArrowDown
            color={isSticky ? colors.neutral200 : "#D6D6DB"}
            size={16}
          />
        </AnimatedTouchableOpacity>
      </View>
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

function useActionButtonPressAnimation() {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    return () => scale.stopAnimation();
  }, [scale]);

  const animateTo = (toValue: number, duration: number) => {
    scale.stopAnimation();
    Animated.timing(scale, {
      duration,
      easing: Easing.out(Easing.cubic),
      toValue,
      useNativeDriver: true,
    }).start();
  };

  return {
    onPressIn: () => animateTo(REPLY_CARD_PRESS_SCALE, 80),
    onPressOut: () => animateTo(1, 140),
    style: { transform: [{ scale }] },
  };
}

function ReplyCard({
  animateEntry = false,
  copyAnimationVersion,
  copied,
  onCopy,
  onLayout,
  presentation = "default",
  recommended,
  reply,
}: {
  animateEntry?: boolean;
  copyAnimationVersion: number;
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
        <MainFeedReplyCard
          copied={copied}
          copyAnimationVersion={copyAnimationVersion}
          onCopy={onCopy}
          reply={reply}
        />
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
  copyAnimationVersion,
  onCopy,
  reply,
}: {
  copied: boolean;
  copyAnimationVersion: number;
  onCopy: () => void;
  reply: SuggestedReply;
}) {
  const tone = toneStyles[reply.tone];
  const pressAnimation = useReplyCardPressAnimation();

  return (
    <AnimatedPressable
      accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
      accessibilityRole="button"
      onPress={() => {
        // Only a real tap (not the start of a scroll) gives feedback.
        tapHaptic();
        pressAnimation.pulse();
        onCopy();
      }}
      style={[styles.mainFeedReplyCardOuter, pressAnimation.cardStyle]}
    >
      <View
        style={[styles.mainFeedReplyCard, { borderColor: tone.cardBorder }]}
      >
        <GlowEllipse
          blur={100}
          fill={tone.glow}
          rotation={-31.97}
          rx={tone.glowRx}
          ry={GLOW_RY}
          style={{
            // Canvas edges that put the glow's centre where Figma has it.
            bottom: tone.glowFromBottom - (GLOW_RY * 2 + 400) / 2,
            left: tone.glowCenterX - (tone.glowRx * 2 + 400) / 2,
            zIndex: 0,
          }}
        />
        <ReplyCardPressStroke
          color={tone.accent}
          opacity={pressAnimation.strokeOpacity}
        />
        <View style={styles.mainFeedReplyContent}>
          <View style={styles.mainFeedReplyHeader}>
            <View
              style={[
                styles.mainFeedToneChip,
                {
                  backgroundColor: tone.chipBackground,
                  borderColor: tone.chipBorder ?? "transparent",
                },
              ]}
            >
              <Text style={styles.mainFeedToneEmoji}>{tone.emoji}</Text>
            </View>
            <ToneMainFeedCopyBadge
              copied={copied}
              copyAnimationVersion={copyAnimationVersion}
              iconColor={tone.accent}
              style={[
                styles.mainFeedCopyBadge,
                { backgroundColor: tone.chipBackground },
              ]}
            />
          </View>
          <Text maxFontSizeMultiplier={1.2} style={styles.mainFeedReplyText}>
            {reply.text || "Reply unavailable"}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}

// Tap feedback of a reply card: it settles in a little and its outline lights
// up in the tone colour, then both ease back. It plays when the tap is
// registered (not when a finger lands, which may be the start of a scroll), and
// there is no fill, so the card never changes colour.
function useReplyCardPressAnimation() {
  const cardScale = useRef(new Animated.Value(1)).current;
  const strokeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      cardScale.stopAnimation();
      strokeOpacity.stopAnimation();
    };
  }, [cardScale, strokeOpacity]);

  const pulse = () => {
    cardScale.stopAnimation();
    strokeOpacity.stopAnimation();
    const to = (scale: number, opacity: number, duration: number) =>
      Animated.parallel([
        Animated.timing(cardScale, {
          duration,
          easing: Easing.out(Easing.cubic),
          toValue: scale,
          useNativeDriver: true,
        }),
        Animated.timing(strokeOpacity, {
          duration,
          easing: Easing.out(Easing.cubic),
          toValue: opacity,
          useNativeDriver: true,
        }),
      ]);
    Animated.sequence([
      to(REPLY_CARD_PRESS_SCALE, REPLY_CARD_PRESS_STROKE_OPACITY, 90),
      to(1, 0, 220),
    ]).start();
  };

  return {
    cardStyle: { transform: [{ scale: cardScale }] },
    pulse,
    strokeOpacity,
  };
}

// A 1 px outline drawn over the card's own border, faded in while pressed.
function ReplyCardPressStroke({
  color,
  opacity,
}: {
  color: string;
  opacity: Animated.Value;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.replyCardPressStroke, { borderColor: color, opacity }]}
    />
  );
}

function ToneMainFeedCopyBadge({
  copied,
  copyAnimationVersion,
  iconColor,
  style,
}: {
  copied: boolean;
  copyAnimationVersion: number;
  iconColor: string;
  style: StyleProp<ViewStyle>;
}) {
  const badgeScale = useRef(new Animated.Value(1)).current;
  const labelOpacity = useRef(new Animated.Value(0)).current;
  const labelTranslateX = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    if (!copied || copyAnimationVersion === 0) return;

    badgeScale.stopAnimation();
    labelOpacity.stopAnimation();
    labelTranslateX.stopAnimation();
    badgeScale.setValue(0.7);
    labelOpacity.setValue(0);
    labelTranslateX.setValue(8);

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(badgeScale, {
          duration: 140,
          easing: Easing.out(Easing.cubic),
          toValue: 1.1,
          useNativeDriver: true,
        }),
        Animated.timing(labelOpacity, {
          delay: 40,
          duration: 120,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(labelTranslateX, {
          delay: 40,
          duration: 120,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.spring(badgeScale, {
        friction: 10,
        tension: 120,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    animation.start();
    return () => animation.stop();
  }, [badgeScale, copied, copyAnimationVersion, labelOpacity, labelTranslateX]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        copied && styles.toneMainFeedCopyButtonCopied,
        { transform: [{ scale: badgeScale }] },
      ]}
    >
      {copied ? (
        <Animated.Text
          style={[
            styles.toneMainFeedCopyButtonText,
            {
              opacity: labelOpacity,
              transform: [{ translateX: labelTranslateX }],
            },
          ]}
        >
          Copied
        </Animated.Text>
      ) : null}
      <Copy color={iconColor} size={18} />
    </Animated.View>
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
    <BottomSheet title="Choose tone" visible={visible} onClose={onClose}>
      <View style={styles.toneOptions}>
        {TONE_OPTIONS.map((option) => {
          const selected = option.value === selectedTone;

          return (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onSelect(option.value)}
              style={[styles.toneOption, selected && styles.toneOptionSelected]}
            >
              <View style={styles.toneOptionLeft}>
                <Text style={styles.toneOptionEmoji}>{option.emoji}</Text>
                <Text
                  style={[
                    styles.toneOptionText,
                    selected && styles.toneOptionTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </View>
              {selected ? <CheckCircle color={COLORS.blue} size={21} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stickyNewRepliesButton: {
    alignItems: "center",
    backgroundColor: colors.primaryBlue,
    borderRadius: STICKY_ACTION_BUTTON.radius,
    flexDirection: "row",
    gap: 6,
    height: STICKY_ACTION_BUTTON.height,
    justifyContent: "center",
    minWidth: STICKY_ACTION_BUTTON.newReplyMinWidth,
    paddingHorizontal: 12,
  },
  stickyNewRepliesButtonShadow: {
    backgroundColor: colors.primaryBlue,
    borderRadius: STICKY_ACTION_BUTTON.radius,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
  },
  stickyNewRepliesButtonText: {
    ...typography.titleSemibold16,
    color: colors.indigo100,
  },
  stickyReplyActionBar: {
    alignItems: "center",
  },
  stickyToneEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  stickyToneSelector: {
    alignItems: "center",
    backgroundColor: colors.stone600,
    // The shared toneSelector style has a border and a fixed width; in the
    // sticky bar the button hugs its content instead.
    borderWidth: 0,
    borderRadius: STICKY_ACTION_BUTTON.radius,
    flexDirection: "row",
    gap: 4,
    height: STICKY_ACTION_BUTTON.height,
    justifyContent: "center",
    paddingHorizontal: 8,
    width: "auto",
  },
  stickyToneSelectorShadow: {
    backgroundColor: colors.stone600,
    borderRadius: STICKY_ACTION_BUTTON.radius,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  stickyToneSelectorText: {
    ...typography.titleSemibold16,
    color: colors.neutral200,
    flexShrink: 1,
  },
  mainFeedCopyBadge: {
    alignItems: "center",
    borderRadius: 20,
    flexDirection: "row",
    gap: 4,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  mainFeedRepliesContent: {
    gap: 12,
  },
  mainFeedReplyCard: {
    backgroundColor: colors.stone900,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  mainFeedReplyCardOuter: {
    borderRadius: 14,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  mainFeedReplyContent: {
    gap: 12,
    padding: 16,
    position: "relative",
    zIndex: 2,
  },
  mainFeedReplyHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  mainFeedReplyText: {
    ...typography.replyText,
    color: colors.stone50,
  },
  mainFeedToneChip: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  mainFeedToneEmoji: {
    fontSize: 18,
    lineHeight: 22,
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
  // Glow centres from the Figma frame: (162.5, 113) closed, and a big soft
  // ellipse just left of the middle, 287 px down, when open.
  inlineVibeBottomGlow: { left: -170, top: 2 },
  inlineVibeCard: {
    backgroundColor: colors.stone900,
    borderColor: surfaces.vibeCheckBorder,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  inlineVibeCardContent: {
    padding: 16,
    position: "relative",
    zIndex: 2,
  },
  inlineVibeCardOuter: {
    borderRadius: 14,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  inlineVibeChevronChip: {
    alignItems: "center",
    backgroundColor: colors.indigo700,
    borderRadius: 20,
    height: 30,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 34,
  },
  inlineVibeExpandedGlow: {
    left: "50%",
    marginLeft: -383.5,
    top: -45,
  },
  inlineVibeChevronIcon: {
    zIndex: 2,
  },
  inlineVibeEmoji: {
    fontSize: 18,
    lineHeight: 21,
  },
  inlineVibeEmojiChip: {
    alignItems: "center",
    backgroundColor: colors.indigo900,
    borderRadius: 20,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  inlineVibeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  inlineVibeMeterTrack: {
    backgroundColor: "rgba(147, 197, 253, 0.3)",
    borderRadius: 8,
    height: 8,
    overflow: "hidden",
    width: "100%",
  },
  inlineVibeMetric: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    padding: 12,
    width: "100%",
  },
  inlineVibeMetricCopy: {
    flex: 1,
    gap: 2,
  },
  inlineVibeMetricHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  inlineVibeMetricIcon: {
    alignItems: "center",
    borderRadius: 11,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  inlineVibeMetricLabel: {
    ...typography.metricLabel,
    lineHeight: 17,
  },
  inlineVibeMetricValue: {
    fontFamily: "ClashDisplay",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 19,
  },
  inlineVibeMetrics: {
    gap: 6,
    marginTop: 12,
    width: "100%",
  },
  inlineVibeSummary: {
    ...typography.summaryMedium16,
    color: colors.stone50,
    lineHeight: 20,
    marginTop: 12,
  },
  inlineVibeTitle: {
    color: colors.indigo50,
    flex: 1,
    fontFamily: fontFamilies.display,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
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
  mainFeedReplyCardWrapper: {
    position: "relative",
  },
  toneMainFeedCopyButtonCopied: {
    paddingHorizontal: 8,
    width: "auto",
  },
  toneMainFeedCopyButtonText: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 17,
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
  replyCardPressStroke: {
    // Covers the card's own 1 px border (the card clips to its border box).
    borderRadius: 14,
    borderWidth: 1,
    bottom: -1,
    left: -1,
    position: "absolute",
    right: -1,
    top: -1,
    zIndex: 3,
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
  toneOptionEmoji: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: "center",
    width: 24,
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
    color: "#E5E5E5",
    flexShrink: 1,
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
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
