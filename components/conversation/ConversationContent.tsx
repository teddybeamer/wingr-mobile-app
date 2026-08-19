import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Reanimated, {
  Easing as ReanimatedEasing,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
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
  Modal,
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

const REPLY_CARD_PRESS_SCALE = 0.985;
const REPLY_CARD_PRESS_OVERLAY_OPACITY = 0.12;
const STICKY_ACTION_BUTTON = {
  height: 45,
  newReplyWidth: 166,
  radius: 24,
  toneWidth: 140,
} as const;
const TONE_SHEET_ANIMATION = {
  backdropCloseDuration: 140,
  backdropOpenDuration: 180,
  sheetCloseDuration: 220,
  sheetOpenDuration: 280,
} as const;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);
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

// This is the unblurred Figma source layer. The canvas adds three standard
// deviations of transparent space on every side, so the SVG filter has room
// to render the blur while the reply card remains the only clipping boundary.
const REPLY_CARD_BOTTOM_GLOW = {
  ellipse: {
    fill: "#404040",
    height: 40,
    right: -19,
    topAboveCardBottom: 39,
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

const PLAYFUL_REPLY_CARD_BOTTOM_GLOW = {
  ...REPLY_CARD_BOTTOM_GLOW,
  ellipse: {
    ...REPLY_CARD_BOTTOM_GLOW.ellipse,
    fill: "#F59E0B",
  },
} as const;

const SMALL_TALK_REPLY_CARD_BOTTOM_GLOW = {
  ...REPLY_CARD_BOTTOM_GLOW,
  ellipse: {
    ...REPLY_CARD_BOTTOM_GLOW.ellipse,
    fill: "#14B8A6",
  },
} as const;

const DIRECT_REPLY_CARD_BOTTOM_GLOW = {
  ...REPLY_CARD_BOTTOM_GLOW,
  ellipse: {
    ...REPLY_CARD_BOTTOM_GLOW.ellipse,
    fill: "#3B82F6",
  },
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
    borderColor: "#1D4ED8",
    iconBackgroundColor: "#1D4ED8",
    iconColor: "#E0E7FF",
    labelColor: "#E0E7FF",
    valueColor: "#3B82F6",
  },
  energy: {
    backgroundColor: "rgba(69, 26, 3, 0.3)",
    borderColor: "#B45309",
    iconBackgroundColor: "#B45309",
    iconColor: "#FEF3C7",
    labelColor: "#FEF3C7",
    valueColor: "#F59E0B",
  },
  risk: {
    backgroundColor: "rgba(69, 10, 10, 0.3)",
    borderColor: "#B91C1C",
    iconBackgroundColor: "#B91C1C",
    iconColor: "#FEE2E2",
    labelColor: "#FEE2E2",
    valueColor: "#EF4444",
  },
  move: {
    backgroundColor: "rgba(4, 47, 46, 0.3)",
    borderColor: "#0F766E",
    iconBackgroundColor: "#0F766E",
    iconColor: "#CCFBF1",
    labelColor: "#CCFBF1",
    valueColor: "#14B8A6",
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

function getInlineConversationEnergyLabel(vibeCheck: VibeCheck) {
  const rawEnergy = vibeCheck.conversationEnergy?.trim() ?? "";
  const lowerEnergy = rawEnergy.toLowerCase();

  if (
    lowerEnergy.includes("dry") ||
    lowerEnergy.includes("short") ||
    lowerEnergy.includes("low")
  ) {
    return "Dry but recoverable";
  }

  if (lowerEnergy.includes("playful") || lowerEnergy.includes("light")) {
    return "Light and playful";
  }

  if (lowerEnergy.includes("high") || lowerEnergy.includes("warm")) {
    return "Warm and flowing";
  }

  return rawEnergy || "Needs a clearer next move";
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
  const chevronStrokeId = useRef("inline-vibe-check-chevron-stroke").current;
  const chevronRotation = useSharedValue(0);
  const pressScale = useSharedValue(1);
  const pressOverlayOpacity = useSharedValue(0);
  const animatedChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));
  const animatedPressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const animatedPressOverlayStyle = useAnimatedStyle(() => ({
    opacity: pressOverlayOpacity.value,
  }));

  useEffect(() => {
    chevronRotation.value = withTiming(isExpanded ? 180 : 0, {
      duration: 180,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic),
    });
  }, [chevronRotation, isExpanded]);

  const toggleExpanded = () => {
    setIsExpanded((current) => !current);
  };

  const animatePressedState = (isPressed: boolean) => {
    const duration = isPressed ? 80 : 140;
    const easing = ReanimatedEasing.out(ReanimatedEasing.cubic);
    pressScale.value = withTiming(isPressed ? REPLY_CARD_PRESS_SCALE : 1, {
      duration,
      easing,
    });
    pressOverlayOpacity.value = withTiming(
      isPressed ? REPLY_CARD_PRESS_OVERLAY_OPACITY : 0,
      { duration, easing },
    );
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
      onPressIn={() => animatePressedState(true)}
      onPressOut={() => animatePressedState(false)}
      style={[styles.inlineVibeCardOuter, animatedPressStyle]}
    >
      <Reanimated.View
        layout={VIBE_CHECK_LAYOUT_TRANSITION}
        style={styles.inlineVibeCard}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[
            styles.replyCardPressOverlay,
            styles.inlineVibePressOverlay,
            animatedPressOverlayStyle,
          ]}
        />
        <View style={styles.inlineVibeCardContent}>
          <View style={styles.inlineVibeHeader}>
            <View style={styles.inlineVibeEmojiChip}>
              <Text style={styles.inlineVibeEmoji}>👀</Text>
            </View>
            <Text style={styles.inlineVibeTitle}>Vibe Check</Text>
            <View style={styles.inlineVibeChevronChip}>
              <Svg
                height="100%"
                pointerEvents="none"
                style={styles.inlineVibeChevronGradientBorder}
                width="100%"
              >
                <Defs>
                  <LinearGradient
                    id={chevronStrokeId}
                    x1="0%"
                    x2="0%"
                    y1="0%"
                    y2="100%"
                  >
                    <Stop offset="0%" stopColor="#4F46E5" />
                    <Stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect
                  fill="none"
                  height="99.5%"
                  rx="14.5"
                  ry="14.5"
                  stroke={`url(#${chevronStrokeId})`}
                  strokeWidth="1"
                  width="99.5%"
                  x="0.5"
                  y="0.5"
                />
              </Svg>
              <Reanimated.View
                style={[styles.inlineVibeChevronIcon, animatedChevronStyle]}
              >
                <AltArrowDown color="#E0E7FF" size={18} />
              </Reanimated.View>
            </View>
          </View>
          <Text style={styles.inlineVibeSummary}>
            {vibeCheck.summary || "Wingr read the vibe."}
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
                  value={getInlineConversationEnergyLabel(vibeCheck)}
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
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
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
  const refreshBorderId = useRef("sticky-refresh-button-border").current;
  const toneBorderId = useRef("sticky-tone-button-border").current;
  const isSticky = variant === "sticky";
  const newReplyPressAnimation = useActionButtonPressAnimation();
  const tonePressAnimation = useActionButtonPressAnimation();

  const refreshReplies = async () => {
    if (isSticky) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    }

    const succeeded = await onRefreshReplies();
    if (succeeded) onReplyGenerated?.();
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
          onPressIn={isSticky ? newReplyPressAnimation.onPressIn : undefined}
          onPressOut={isSticky ? newReplyPressAnimation.onPressOut : undefined}
          style={[
            isSticky ? styles.stickyNewRepliesButton : styles.newRepliesButton,
            isGenerating && styles.disabled,
            isSticky && newReplyPressAnimation.style,
          ]}
        >
          {isSticky ? (
            <ActionButtonGradientBorder
              color="#4338CA"
              gradientId={refreshBorderId}
              width={STICKY_ACTION_BUTTON.newReplyWidth}
            />
          ) : null}
          {isGenerating ? (
            <ActivityIndicator color="#E0E7FF" size="small" />
          ) : (
            <>
              {isSticky ? (
                <Repeat color="#E0E7FF" size={20} />
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
            <ActionButtonGradientBorder
              color="#525252"
              gradientId={toneBorderId}
              width={STICKY_ACTION_BUTTON.toneWidth}
            />
          ) : null}
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
          <AltArrowDown color="#D6D6DB" size={isSticky ? 18 : 16} />
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

function ActionButtonGradientBorder({
  color,
  gradientId,
  width,
}: {
  color: string;
  gradientId: string;
  width: number;
}) {
  return (
    <Svg
      height={STICKY_ACTION_BUTTON.height}
      pointerEvents="none"
      style={styles.stickyActionButtonGradientBorder}
      width={width}
    >
      <Defs>
        <LinearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
          <Stop offset="0%" stopColor={color} />
          <Stop offset="100%" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect
        fill="none"
        height={STICKY_ACTION_BUTTON.height - 1}
        rx={STICKY_ACTION_BUTTON.radius}
        ry={STICKY_ACTION_BUTTON.radius}
        stroke={`url(#${gradientId})`}
        strokeWidth="1"
        width={width - 1}
        x="0.5"
        y="0.5"
      />
    </Svg>
  );
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
  const toneChipStyle = TONE_CHIP_STYLES[reply.tone];

  if (reply.tone === "playful") {
    return (
      <PlayfulMainFeedReplyCard
        copied={copied}
        copyAnimationVersion={copyAnimationVersion}
        onCopy={onCopy}
        reply={reply}
      />
    );
  }

  if (reply.tone === "casualSmallTalk") {
    return (
      <SmallTalkMainFeedReplyCard
        copied={copied}
        copyAnimationVersion={copyAnimationVersion}
        onCopy={onCopy}
        reply={reply}
      />
    );
  }

  if (reply.tone === "direct") {
    return (
      <DirectMainFeedReplyCard
        copied={copied}
        copyAnimationVersion={copyAnimationVersion}
        onCopy={onCopy}
        reply={reply}
      />
    );
  }

  return (
    <GlassMaterialCard
      materialId={`reply-${reply.id}`}
      contentStyle={styles.mainFeedReplyContent}
    >
      <View style={styles.mainFeedReplyHeader}>
        <View style={[styles.mainFeedToneChip, toneChipStyle]}>
          <Text style={styles.mainFeedToneEmoji}>
            {TONE_EMOJIS[reply.tone]}
          </Text>
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

function PlayfulMainFeedReplyCard({
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
  const bottomGlowId = useRef(`playful-reply-bottom-glow-${reply.id}`).current;
  const strokeId = useRef(`playful-reply-stroke-${reply.id}`).current;
  const pressAnimation = useReplyCardPressAnimation();

  return (
    <AnimatedPressable
      accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
      accessibilityRole="button"
      onPress={onCopy}
      onPressIn={pressAnimation.onPressIn}
      onPressOut={pressAnimation.onPressOut}
      style={[styles.playfulMainFeedReplyCardOuter, pressAnimation.cardStyle]}
    >
      <View style={styles.playfulMainFeedReplyCard}>
        <ReplyCardBottomGlow
          fill={PLAYFUL_REPLY_CARD_BOTTOM_GLOW.ellipse.fill}
          filterId={bottomGlowId}
          style={styles.playfulMainFeedReplyBottomGlow}
        />
        <ReplyCardPressOverlay
          color="#B45309"
          opacity={pressAnimation.overlayOpacity}
        />
        <Svg
          height="100%"
          pointerEvents="none"
          style={styles.playfulMainFeedGradientBorder}
          width="100%"
        >
          <Defs>
            <LinearGradient id={strokeId} x1="0%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#B45309" />
              <Stop offset="100%" stopColor="#B45309" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect
            fill="none"
            height="99.5%"
            rx="14"
            ry="14"
            stroke={`url(#${strokeId})`}
            strokeWidth="1"
            width="99.5%"
            x="0.5"
            y="0.5"
          />
        </Svg>
        <View style={styles.playfulMainFeedReplyContent}>
          <View style={styles.playfulMainFeedReplyHeader}>
            <View style={styles.playfulMainFeedToneChip}>
              <Text style={styles.playfulMainFeedToneEmoji}>🔥</Text>
            </View>
            <ToneMainFeedCopyBadge
              copied={copied}
              copyAnimationVersion={copyAnimationVersion}
              style={styles.playfulMainFeedCopyButton}
            />
          </View>
          <Text style={styles.playfulMainFeedReplyText}>
            {reply.text || "Reply unavailable"}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}

function SmallTalkMainFeedReplyCard({
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
  const bottomGlowId = useRef(
    `small-talk-reply-bottom-glow-${reply.id}`,
  ).current;
  const strokeId = useRef(`small-talk-reply-stroke-${reply.id}`).current;
  const pressAnimation = useReplyCardPressAnimation();

  return (
    <AnimatedPressable
      accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
      accessibilityRole="button"
      onPress={onCopy}
      onPressIn={pressAnimation.onPressIn}
      onPressOut={pressAnimation.onPressOut}
      style={[styles.smallTalkMainFeedReplyCardOuter, pressAnimation.cardStyle]}
    >
      <View style={styles.smallTalkMainFeedReplyCard}>
        <ReplyCardBottomGlow
          fill={SMALL_TALK_REPLY_CARD_BOTTOM_GLOW.ellipse.fill}
          filterId={bottomGlowId}
          style={styles.smallTalkMainFeedReplyBottomGlow}
        />
        <ReplyCardPressOverlay
          color="#0F766E"
          opacity={pressAnimation.overlayOpacity}
        />
        <Svg
          height="100%"
          pointerEvents="none"
          style={styles.smallTalkMainFeedGradientBorder}
          width="100%"
        >
          <Defs>
            <LinearGradient id={strokeId} x1="0%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#0F766E" />
              <Stop offset="100%" stopColor="#0F766E" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect
            fill="none"
            height="99.5%"
            rx="14"
            ry="14"
            stroke={`url(#${strokeId})`}
            strokeWidth="1"
            width="99.5%"
            x="0.5"
            y="0.5"
          />
        </Svg>
        <View style={styles.smallTalkMainFeedReplyContent}>
          <View style={styles.smallTalkMainFeedReplyHeader}>
            <View style={styles.smallTalkMainFeedToneChip}>
              <Text style={styles.smallTalkMainFeedToneEmoji}>😊</Text>
            </View>
            <ToneMainFeedCopyBadge
              copied={copied}
              copyAnimationVersion={copyAnimationVersion}
              style={styles.smallTalkMainFeedCopyButton}
            />
          </View>
          <Text style={styles.smallTalkMainFeedReplyText}>
            {reply.text || "Reply unavailable"}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}

function DirectMainFeedReplyCard({
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
  const bottomGlowId = useRef(`direct-reply-bottom-glow-${reply.id}`).current;
  const strokeId = useRef(`direct-reply-stroke-${reply.id}`).current;
  const pressAnimation = useReplyCardPressAnimation();

  return (
    <AnimatedPressable
      accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
      accessibilityRole="button"
      onPress={onCopy}
      onPressIn={pressAnimation.onPressIn}
      onPressOut={pressAnimation.onPressOut}
      style={[styles.directMainFeedReplyCardOuter, pressAnimation.cardStyle]}
    >
      <View style={styles.directMainFeedReplyCard}>
        <ReplyCardBottomGlow
          fill={DIRECT_REPLY_CARD_BOTTOM_GLOW.ellipse.fill}
          filterId={bottomGlowId}
          style={styles.directMainFeedReplyBottomGlow}
        />
        <ReplyCardPressOverlay
          color="#1D4ED8"
          opacity={pressAnimation.overlayOpacity}
        />
        <Svg
          height="100%"
          pointerEvents="none"
          style={styles.directMainFeedGradientBorder}
          width="100%"
        >
          <Defs>
            <LinearGradient id={strokeId} x1="0%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#1D4ED8" />
              <Stop offset="100%" stopColor="#1D4ED8" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect
            fill="none"
            height="99.5%"
            rx="14"
            ry="14"
            stroke={`url(#${strokeId})`}
            strokeWidth="1"
            width="99.5%"
            x="0.5"
            y="0.5"
          />
        </Svg>
        <View style={styles.directMainFeedReplyContent}>
          <View style={styles.directMainFeedReplyHeader}>
            <View style={styles.directMainFeedToneChip}>
              <Text style={styles.directMainFeedToneEmoji}>🎯</Text>
            </View>
            <ToneMainFeedCopyBadge
              copied={copied}
              copyAnimationVersion={copyAnimationVersion}
              style={styles.directMainFeedCopyButton}
            />
          </View>
          <Text style={styles.directMainFeedReplyText}>
            {reply.text || "Reply unavailable"}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}

function useReplyCardPressAnimation() {
  const cardScale = useRef(new Animated.Value(1)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      cardScale.stopAnimation();
      overlayOpacity.stopAnimation();
    };
  }, [cardScale, overlayOpacity]);

  const animateTo = (scale: number, opacity: number, duration: number) => {
    cardScale.stopAnimation();
    overlayOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(cardScale, {
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: scale,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        duration,
        easing: Easing.out(Easing.cubic),
        toValue: opacity,
        useNativeDriver: true,
      }),
    ]).start();
  };

  return {
    cardStyle: { transform: [{ scale: cardScale }] },
    onPressIn: () =>
      animateTo(REPLY_CARD_PRESS_SCALE, REPLY_CARD_PRESS_OVERLAY_OPACITY, 80),
    onPressOut: () => animateTo(1, 0, 140),
    overlayOpacity,
  };
}

function ReplyCardPressOverlay({
  color,
  opacity,
}: {
  color: string;
  opacity: Animated.Value;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.replyCardPressOverlay,
        { backgroundColor: color, opacity },
      ]}
    />
  );
}

function ToneMainFeedCopyBadge({
  copied,
  copyAnimationVersion,
  style,
}: {
  copied: boolean;
  copyAnimationVersion: number;
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
      <Copy color="#FFFFFF" size={18} />
    </Animated.View>
  );
}

function ReplyCardBottomGlow({
  fill,
  filterId,
  style,
}: {
  fill: string;
  filterId: string;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <Svg
      height={REPLY_CARD_BOTTOM_GLOW_CANVAS.height}
      pointerEvents="none"
      style={style}
      width={REPLY_CARD_BOTTOM_GLOW_CANVAS.width}
    >
      <Defs>
        <Filter
          filterUnits="userSpaceOnUse"
          height={REPLY_CARD_BOTTOM_GLOW_CANVAS.height}
          id={filterId}
          primitiveUnits="userSpaceOnUse"
          width={REPLY_CARD_BOTTOM_GLOW_CANVAS.width}
          x={0}
          y={0}
        >
          <FeGaussianBlur stdDeviation={REPLY_CARD_BOTTOM_GLOW.stdDeviation} />
        </Filter>
      </Defs>
      <Ellipse
        cx={REPLY_CARD_BOTTOM_GLOW_CANVAS.x}
        cy={REPLY_CARD_BOTTOM_GLOW_CANVAS.y}
        fill={fill}
        filter={`url(#${filterId})`}
        rx={REPLY_CARD_BOTTOM_GLOW.ellipse.width / 2}
        ry={REPLY_CARD_BOTTOM_GLOW.ellipse.height / 2}
      />
    </Svg>
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
        <ReplyCardBottomGlow
          fill={REPLY_CARD_BOTTOM_GLOW.ellipse.fill}
          filterId={bottomGlowId}
          style={styles.mainFeedReplyBottomGlow}
        />
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
  const { height: windowHeight } = useWindowDimensions();
  const [isPresented, setIsPresented] = useState(visible);
  const isPresentedRef = useRef(visible);
  const sheetTravelDistanceRef = useRef(windowHeight);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    sheetTravelDistanceRef.current = windowHeight;
  }, [windowHeight]);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    let animationFrame: number | null = null;
    const sheetTravelDistance = sheetTravelDistanceRef.current;

    if (visible) {
      if (!isPresentedRef.current) {
        isPresentedRef.current = true;
        backdropOpacity.setValue(0);
        sheetTranslateY.setValue(sheetTravelDistance);
        setIsPresented(true);
      }

      animationFrame = requestAnimationFrame(() => {
        animation = Animated.parallel([
          Animated.timing(backdropOpacity, {
            duration: TONE_SHEET_ANIMATION.backdropOpenDuration,
            easing: Easing.out(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(sheetTranslateY, {
            duration: TONE_SHEET_ANIMATION.sheetOpenDuration,
            easing: Easing.out(Easing.cubic),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]);
        animation.start();
      });
    } else if (isPresentedRef.current) {
      animation = Animated.parallel([
        Animated.timing(backdropOpacity, {
          duration: TONE_SHEET_ANIMATION.backdropCloseDuration,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          duration: TONE_SHEET_ANIMATION.sheetCloseDuration,
          easing: Easing.in(Easing.cubic),
          toValue: sheetTravelDistance,
          useNativeDriver: true,
        }),
      ]);
      animation.start(({ finished }) => {
        if (finished) {
          isPresentedRef.current = false;
          setIsPresented(false);
        }
      });
    }

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
      animation?.stop();
    };
  }, [backdropOpacity, sheetTranslateY, visible]);

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      transparent
      visible={isPresented}
    >
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.sheetBackdrop, { opacity: backdropOpacity }]}
      >
        <Pressable onPress={onClose} style={styles.sheetBackdropPressTarget}>
          <Animated.View
            style={[
              styles.sheetPanelAnimation,
              { transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            <Pressable style={styles.sheetPanel}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Choose tone</Text>
              <View style={styles.toneOptions}>
                {TONE_OPTIONS.map((option) => {
                  const selected = option.value === selectedTone;

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
                        <Text style={styles.toneOptionEmoji}>
                          {option.emoji}
                        </Text>
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
          </Animated.View>
        </Pressable>
      </Animated.View>
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
  inlineVibeCard: {
    backgroundColor: "rgba(49, 46, 129, 0.2)",
    borderColor: "#4338CA",
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
    backgroundColor: "#4338CA",
    borderRadius: 20,
    height: 30,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: 34,
  },
  inlineVibeChevronGradientBorder: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
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
    backgroundColor: "rgba(49, 46, 129, 0.5)",
    borderColor: "#3730A3",
    borderRadius: 20,
    borderWidth: 1,
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
    fontFamily: "ClashGrotesk",
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 16,
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
  inlineVibePressOverlay: {
    backgroundColor: "#4338CA",
  },
  inlineVibeSummary: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 20,
    marginTop: 12,
  },
  inlineVibeTitle: {
    color: "#E0E7FF",
    flex: 1,
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "700",
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
  directMainFeedCopyButton: {
    alignItems: "center",
    backgroundColor: "#1D4ED8",
    borderColor: "#2563EB",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  directMainFeedGradientBorder: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
  },
  directMainFeedReplyBottomGlow: {
    bottom: REPLY_CARD_BOTTOM_GLOW_CANVAS.bottom,
    height: REPLY_CARD_BOTTOM_GLOW_CANVAS.height,
    position: "absolute",
    right: REPLY_CARD_BOTTOM_GLOW_CANVAS.right,
    width: REPLY_CARD_BOTTOM_GLOW_CANVAS.width,
    zIndex: 1,
  },
  directMainFeedReplyCard: {
    backgroundColor: "rgba(30, 58, 138, 0.38)",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  directMainFeedReplyCardOuter: {
    borderRadius: 14,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  directMainFeedReplyContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    position: "relative",
    zIndex: 2,
  },
  directMainFeedReplyHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  directMainFeedReplyText: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: 16,
  },
  directMainFeedToneChip: {
    alignItems: "center",
    backgroundColor: "rgba(30, 58, 138, 0.5)",
    borderColor: "#1E3A8A",
    borderRadius: 20,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  directMainFeedToneEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  playfulMainFeedCopyButton: {
    alignItems: "center",
    backgroundColor: "#B45309",
    borderColor: "#D97706",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  playfulMainFeedReplyBottomGlow: {
    bottom: REPLY_CARD_BOTTOM_GLOW_CANVAS.bottom,
    height: REPLY_CARD_BOTTOM_GLOW_CANVAS.height,
    position: "absolute",
    right: REPLY_CARD_BOTTOM_GLOW_CANVAS.right,
    width: REPLY_CARD_BOTTOM_GLOW_CANVAS.width,
    zIndex: 1,
  },
  playfulMainFeedReplyCard: {
    backgroundColor: "rgba(124, 45, 18, 0.38)",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  playfulMainFeedReplyCardOuter: {
    borderRadius: 14,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  playfulMainFeedReplyContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    position: "relative",
    zIndex: 2,
  },
  playfulMainFeedGradientBorder: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
  },
  playfulMainFeedReplyHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  playfulMainFeedReplyText: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: 16,
  },
  playfulMainFeedToneChip: {
    alignItems: "center",
    backgroundColor: "rgba(120, 53, 15, 0.5)",
    borderColor: "#78350F",
    borderRadius: 20,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  playfulMainFeedToneEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  smallTalkMainFeedCopyButton: {
    alignItems: "center",
    backgroundColor: "#0F766E",
    borderColor: "#0D9488",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  smallTalkMainFeedGradientBorder: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
  },
  smallTalkMainFeedReplyBottomGlow: {
    bottom: REPLY_CARD_BOTTOM_GLOW_CANVAS.bottom,
    height: REPLY_CARD_BOTTOM_GLOW_CANVAS.height,
    position: "absolute",
    right: REPLY_CARD_BOTTOM_GLOW_CANVAS.right,
    width: REPLY_CARD_BOTTOM_GLOW_CANVAS.width,
    zIndex: 1,
  },
  smallTalkMainFeedReplyCard: {
    backgroundColor: "rgba(19, 78, 74, 0.38)",
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
  },
  smallTalkMainFeedReplyCardOuter: {
    borderRadius: 14,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  smallTalkMainFeedReplyContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    position: "relative",
    zIndex: 2,
  },
  smallTalkMainFeedReplyHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  smallTalkMainFeedReplyText: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: 16,
  },
  smallTalkMainFeedToneChip: {
    alignItems: "center",
    backgroundColor: "rgba(19, 78, 74, 0.5)",
    borderColor: "#115E59",
    borderRadius: 20,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  smallTalkMainFeedToneEmoji: {
    fontSize: 18,
    lineHeight: 22,
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
  replyCardPressOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
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
  },
  sheetBackdropPressTarget: {
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
  sheetPanelAnimation: {
    width: "100%",
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
    backgroundColor: "#3730A3",
    borderRadius: STICKY_ACTION_BUTTON.radius,
    flexDirection: "row",
    gap: 8,
    height: STICKY_ACTION_BUTTON.height,
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 12,
    position: "relative",
    width: STICKY_ACTION_BUTTON.newReplyWidth,
  },
  stickyNewRepliesButtonShadow: {
    backgroundColor: "#3730A3",
    borderRadius: STICKY_ACTION_BUTTON.radius,
    elevation: 4,
    height: STICKY_ACTION_BUTTON.height,
    overflow: "visible",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    width: STICKY_ACTION_BUTTON.newReplyWidth,
  },
  stickyNewRepliesButtonText: {
    color: "#E0E7FF",
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 20,
  },
  stickyReplyActionBar: {
    alignItems: "center",
    height: STICKY_ACTION_BUTTON.height,
    width: "100%",
  },
  stickyActionButtonGradientBorder: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  stickyToneEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  stickyToneSelector: {
    backgroundColor: "#404040",
    borderColor: "transparent",
    borderRadius: STICKY_ACTION_BUTTON.radius,
    borderWidth: 0,
    gap: 6,
    height: STICKY_ACTION_BUTTON.height,
    justifyContent: "flex-start",
    overflow: "hidden",
    paddingHorizontal: 12,
    position: "relative",
    width: STICKY_ACTION_BUTTON.toneWidth,
  },
  stickyToneSelectorShadow: {
    backgroundColor: "#404040",
    borderRadius: STICKY_ACTION_BUTTON.radius,
    elevation: 4,
    height: STICKY_ACTION_BUTTON.height,
    overflow: "visible",
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    width: STICKY_ACTION_BUTTON.toneWidth,
  },
  stickyToneSelectorText: {
    color: "#D4D4D4",
    flexShrink: 1,
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 20,
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
