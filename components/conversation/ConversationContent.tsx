import * as Clipboard from "expo-clipboard";
import { useState } from "react";
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
import Svg, { Defs, Ellipse, FeGaussianBlur, Filter } from "react-native-svg";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
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

export function VibeCheckCard({ vibeCheck }: { vibeCheck: VibeCheck }) {
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

export function RepliesContent({
  isGenerating,
  maxReplies = 2,
  onRefreshReplies,
  onToneChange,
  replies = [],
  selectedTone,
  showControls = true,
}: {
  isGenerating: boolean;
  maxReplies?: number;
  onRefreshReplies: () => Promise<boolean>;
  onToneChange: (tone: ReplyTone) => Promise<boolean>;
  replies?: SuggestedReply[];
  selectedTone: ReplyTone;
  showControls?: boolean;
}) {
  const [isToneSheetOpen, setIsToneSheetOpen] = useState(false);
  const [copiedReplyId, setCopiedReplyId] = useState<string | null>(null);

  const copyReply = async (reply: SuggestedReply) => {
    const didCopy = await Clipboard.setStringAsync(reply.text || "");

    if (didCopy) {
      setCopiedReplyId(reply.id);
    }
  };

  return (
    <View style={styles.repliesContent}>
      {showControls ? (
        <View style={styles.repliesControlsRow}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isGenerating}
            onPress={async () => {
              const succeeded = await onRefreshReplies();
              if (succeeded) setCopiedReplyId(null);
            }}
            style={[styles.newRepliesButton, isGenerating && styles.disabled]}
          >
            {isGenerating ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Refresh color={COLORS.white} size={16} />
                <Text style={styles.newRepliesButtonText}>New Replies</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isGenerating}
            onPress={() => setIsToneSheetOpen(true)}
            style={styles.toneSelector}
          >
            <StarsMinimalistic color="#D6D6DB" size={14} />
            <Text numberOfLines={1} style={styles.toneSelectorText}>
              {getToneLabel(selectedTone)}
            </Text>
            <AltArrowDown color="#D6D6DB" size={16} />
          </TouchableOpacity>
        </View>
      ) : null}

      {replies.length === 0 && isGenerating ? (
        <View style={styles.repliesLoadingCard}>
          <ActivityIndicator color={COLORS.blue} />
          <Text style={styles.repliesLoadingText}>Writing replies...</Text>
        </View>
      ) : null}

      {replies.slice(0, maxReplies).map((reply, index) => (
        <ReplyCard
          copied={copiedReplyId === reply.id}
          key={reply.id}
          onCopy={() => copyReply(reply)}
          recommended={index === 0}
          reply={reply}
        />
      ))}

      {showControls ? (
        <ToneBottomSheet
          onClose={() => setIsToneSheetOpen(false)}
          onSelect={async (tone) => {
            setIsToneSheetOpen(false);
            const succeeded = await onToneChange(tone);
            if (succeeded) setCopiedReplyId(null);
          }}
          selectedTone={selectedTone}
          visible={isToneSheetOpen}
        />
      ) : null}
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
