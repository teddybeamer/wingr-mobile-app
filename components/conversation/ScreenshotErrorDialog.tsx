import { ArrowLeft, GalleryAdd } from "@solar-icons/react-native/Linear";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import type { ConversationFlowError } from "../../hooks/useConversationFlow";
import {
  createDeferredScreenshotPicker,
  getSemanticScreenshotError,
} from "../../lib/screenshot-analysis-error";
import { colors, iconSizes, radii, spacing, typography } from "../../theme";
import { ActionButton } from "../ActionButton";
import { DialogModal } from "../DialogModal";

const HERO_IMAGE = require("../../assets/images/redesign/errors/hero-cant-read.png");

type Tip = {
  body: string;
  good: boolean;
  id: string;
  image: number;
  title: string;
};

const TIPS: Tip[] = [
  {
    body: "Make sure the messages are clear and not too small.",
    good: true,
    id: "readable",
    image: require("../../assets/images/redesign/tips/tip-readable.png"),
    title: "Keep the text readable",
  },
  {
    body: "Include the most recent part of your conversation.",
    good: true,
    id: "latest",
    image: require("../../assets/images/redesign/tips/tip-latest.png"),
    title: "Show the latest messages",
  },
  {
    body: "Avoid cropping out important messages or covering them with stickers, edits or other elements.",
    good: false,
    id: "visible",
    image: require("../../assets/images/redesign/tips/tip-visible.png"),
    title: "Keep the chat visible",
  },
];

// Shown when the backend says a screenshot cannot be used (unreadable, no
// conversation, ...). Two pages in one dialog: the error with Get Tips / Got it,
// and the Screenshot Tips.
//
// "Got it" only closes the dialog, because the screen behind it (Screenshot
// Chosen) already has Change Screenshot. Onboarding has no such control (its
// Vibe Check shows no inline error for this case), so it passes
// `onChooseAnotherScreenshot`: the same button then reads "Choose New
// Screenshot" and, once the dialog is gone, opens the photo picker.
export function ScreenshotErrorDialog({
  error,
  initialPage = "error",
  onChooseAnotherScreenshot,
}: {
  error: ConversationFlowError | null;
  // Only the dev preview starts on the tips page; in the app it opens on the
  // error.
  initialPage?: "error" | "tips";
  onChooseAnotherScreenshot?: () => void | Promise<void>;
}) {
  const semanticError = getSemanticScreenshotError(error);
  const [activeError, setActiveError] = useState(semanticError);
  const [visible, setVisible] = useState(Boolean(semanticError));
  const [page, setPage] = useState<"error" | "tips">(initialPage);
  const pageFade = useRef(new Animated.Value(1)).current;
  const chooseScreenshotRef = useRef(onChooseAnotherScreenshot);
  chooseScreenshotRef.current = onChooseAnotherScreenshot;
  const deferredPickerRef = useRef(
    createDeferredScreenshotPicker(async () => {
      await chooseScreenshotRef.current?.();
    }),
  );
  const shownErrorIdRef = useRef<number | null>(semanticError?.id ?? null);

  useEffect(() => {
    if (!semanticError || semanticError.id === shownErrorIdRef.current) return;
    shownErrorIdRef.current = semanticError.id;
    deferredPickerRef.current.cancel();
    setActiveError(semanticError);
    setPage("error");
    setVisible(true);
  }, [semanticError]);

  useEffect(() => {
    pageFade.setValue(0);
    const animation = Animated.timing(pageFade, {
      duration: 160,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [page, pageFade]);

  if (!activeError) return null;

  const canChooseAnother = Boolean(onChooseAnotherScreenshot);
  const primaryLabel = canChooseAnother ? "Choose New Screenshot" : "Got it";

  const dismiss = () => {
    deferredPickerRef.current.cancel();
    setVisible(false);
  };

  const handlePrimary = () => {
    if (canChooseAnother) deferredPickerRef.current.request();
    setVisible(false);
  };

  return (
    <DialogModal
      onClose={dismiss}
      onClosed={() => {
        void deferredPickerRef.current.sheetClosed();
      }}
      visible={visible}
    >
      <Animated.View style={{ opacity: pageFade }}>
        {page === "error" ? (
          <ErrorPage
            message={activeError.presentation.message}
            onGetTips={() => setPage("tips")}
            onPrimary={handlePrimary}
            primaryLabel={primaryLabel}
            title={activeError.presentation.title}
          />
        ) : (
          <TipsPage
            onBack={() => setPage("error")}
            onPrimary={handlePrimary}
            primaryLabel={primaryLabel}
            showPickerIcon={canChooseAnother}
          />
        )}
      </Animated.View>
    </DialogModal>
  );
}

function ErrorPage({
  message,
  onGetTips,
  onPrimary,
  primaryLabel,
  title,
}: {
  message: string;
  onGetTips: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  title: string;
}) {
  return (
    <View style={styles.errorPage}>
      <View style={styles.hero}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={HERO_IMAGE}
          style={styles.heroImage}
        />
      </View>
      <View style={styles.errorBody}>
        <View style={styles.errorCopy}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
            style={styles.errorTitle}
          >
            {title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.errorMessage}>
            {message}
          </Text>
        </View>
        <View style={styles.buttons}>
          <ActionButton
            label="Get Tips"
            onPress={onGetTips}
            size="compact"
            variant="secondary"
          />
          <ActionButton
            label={primaryLabel}
            onPress={onPrimary}
            size="compact"
            variant="primary"
          />
        </View>
      </View>
    </View>
  );
}

function TipsPage({
  onBack,
  onPrimary,
  primaryLabel,
  showPickerIcon,
}: {
  onBack: () => void;
  onPrimary: () => void;
  primaryLabel: string;
  showPickerIcon: boolean;
}) {
  return (
    <View style={styles.tipsPage}>
      <View style={styles.tipsHeader}>
        <TouchableOpacity
          accessibilityLabel="Back"
          accessibilityRole="button"
          activeOpacity={0.6}
          hitSlop={10}
          onPress={onBack}
          style={styles.tipsBack}
        >
          <ArrowLeft color={colors.stone950} size={iconSizes.lg} />
        </TouchableOpacity>
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={styles.tipsTitle}
        >
          Screenshot Tips
        </Text>
        {/* Invisible: keeps the title centred over the back arrow. */}
        <View style={styles.tipsBack} />
      </View>

      {TIPS.map((tip, index) => (
        <View key={tip.id}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <View style={styles.tipRow}>
            <View style={styles.tipIllustration}>
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                source={tip.image}
                style={styles.tipImage}
              />
              <View style={styles.badge}>
                <TipBadge good={tip.good} />
              </View>
            </View>
            <View style={styles.tipCopy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.tipTitle}>
                {tip.title}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.tipBody}>
                {tip.body}
              </Text>
            </View>
          </View>
        </View>
      ))}

      <View style={styles.tipsAction}>
        <ActionButton
          label={primaryLabel}
          leading={
            showPickerIcon ? (
              <GalleryAdd color={colors.stone50} size={iconSizes.md} />
            ) : undefined
          }
          onPress={onPrimary}
          size="compact"
          variant="primary"
        />
      </View>
    </View>
  );
}

// Green check for a good example, red cross for a bad one.
function TipBadge({ good }: { good: boolean }) {
  return (
    <Svg height={20} viewBox="0 0 20 20" width={20}>
      <Circle
        cx={10}
        cy={10}
        fill={good ? colors.green500 : colors.red500}
        r={10}
      />
      {good ? (
        <Path
          d="M6 10.9186L8.47622 13.755L14.6667 6.66406"
          fill="none"
          stroke={colors.green200}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.4}
        />
      ) : (
        <Path
          d="M14 6L6 14M6 6L14 14"
          fill="none"
          stroke={colors.red200}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.4}
        />
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  badge: { bottom: -4, position: "absolute", right: -4 },
  buttons: { gap: spacing.sm },
  divider: {
    backgroundColor: colors.stone300,
    height: StyleSheet.hairlineWidth * 2,
    marginHorizontal: 20,
  },
  errorBody: {
    gap: spacing.xl,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  errorCopy: { gap: spacing.md },
  errorMessage: { ...typography.body, color: "#000000" },
  errorPage: { gap: spacing.md },
  errorTitle: { ...typography.h2, color: "#000000" },
  hero: {
    aspectRatio: 273 / 163,
    backgroundColor: colors.stone500,
    borderRadius: radii.lg,
    overflow: "hidden",
    width: "100%",
  },
  heroImage: { height: "100%", width: "100%" },
  tipBody: { ...typography.body, color: colors.stone800 },
  tipCopy: { flex: 1, gap: spacing.md, justifyContent: "center" },
  tipIllustration: { height: 100, width: 110 },
  tipImage: { borderRadius: radii.lg, height: 100, width: 110 },
  tipRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 20,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  tipTitle: { ...typography.titleSemibold16, color: "#000000" },
  tipsAction: { paddingHorizontal: spacing.xs, paddingVertical: spacing.md },
  tipsBack: { height: iconSizes.lg, width: iconSizes.lg },
  tipsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  tipsPage: { gap: spacing.xs },
  tipsTitle: {
    ...typography.titleSemibold16,
    color: colors.stone950,
    flexShrink: 1,
  },
});
