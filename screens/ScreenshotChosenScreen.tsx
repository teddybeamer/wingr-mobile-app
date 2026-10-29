import { ArrowRight, GalleryRemove } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ActionButton } from "../components/ActionButton";
import { FittedScreenshot } from "../components/FittedScreenshot";
import { HeaderBackButton } from "../components/HeaderBackButton";
import { ScreenHeader, ScreenHeaderTitle } from "../components/ScreenHeader";
import {
  ScreenshotPreviewModal,
  type WindowRect,
} from "../components/ScreenshotPreviewModal";
import { StageColumn } from "../components/StageColumn";
import { colors, iconSizes, radii, spacing, typography } from "../theme";

const STAGE_BACKDROP = require("../assets/images/redesign/choose/stage-backdrop.jpg");

// Room around the screenshot inside the stage: a little more below than above
// so its shadow has space (as in the Figma stage).
const STAGE_PADDING = { bottom: 26, horizontal: 16, top: 18 } as const;

export function ScreenshotChosenScreen({
  errorMessage,
  onBack,
  onChangeScreenshot,
  onGetReplies,
  onRevealStarted,
  revealToken,
  selectedScreenshotUri,
}: {
  errorMessage?: string | null;
  onBack: () => void;
  onChangeScreenshot: () => void;
  onGetReplies: () => void;
  onRevealStarted: (revealToken: number) => void;
  revealToken: number | null;
  selectedScreenshotUri: string | null;
}) {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  // The preview shows the screenshot itself while it is open, so this copy is
  // hidden for that time.
  const [isScreenshotHidden, setIsScreenshotHidden] = useState(false);
  const [previewSource, setPreviewSource] = useState<WindowRect | null>(null);
  const screenshotFrameRef = useRef<View>(null);
  const [isInteractive, setIsInteractive] = useState(revealToken === null);
  const screenshotOpacity = useRef(new Animated.Value(1)).current;
  const screenshotScale = useRef(new Animated.Value(1)).current;
  const screenshotTranslateY = useRef(new Animated.Value(0)).current;
  const footerOpacity = useRef(new Animated.Value(1)).current;
  const footerScale = useRef(new Animated.Value(1)).current;
  const preparedTokenRef = useRef<number | null>(null);
  const startedTokenRef = useRef<number | null>(null);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const frameRef = useRef<number | null>(null);

  // Hide the screenshot and footer before first paint when the entry
  // animation is pending.
  useLayoutEffect(() => {
    if (revealToken === null || preparedTokenRef.current === revealToken) {
      return;
    }
    animationRef.current?.stop();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    preparedTokenRef.current = revealToken;
    screenshotOpacity.setValue(0);
    screenshotScale.setValue(0.82);
    screenshotTranslateY.setValue(8);
    footerOpacity.setValue(0);
    footerScale.setValue(0.92);
    setIsInteractive(false);
  }, [
    footerOpacity,
    footerScale,
    revealToken,
    screenshotOpacity,
    screenshotScale,
    screenshotTranslateY,
  ]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const startReveal = () => {
    if (
      revealToken === null ||
      preparedTokenRef.current !== revealToken ||
      startedTokenRef.current === revealToken
    ) {
      return;
    }
    startedTokenRef.current = revealToken;
    onRevealStarted(revealToken);

    animationRef.current = Animated.parallel([
      Animated.parallel([
        Animated.timing(screenshotOpacity, {
          duration: 130,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(screenshotScale, {
          friction: 9,
          tension: 160,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(screenshotTranslateY, {
          friction: 9,
          tension: 160,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(100),
        Animated.parallel([
          Animated.timing(footerOpacity, {
            duration: 160,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.spring(footerScale, {
            friction: 12,
            tension: 130,
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]);
    animationRef.current.start(({ finished }) => {
      if (finished) setIsInteractive(true);
    });
  };

  // The entry animation starts once the screenshot has loaded (or failed).
  const handleScreenshotReady = () => {
    if (revealToken === null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      startReveal();
    });
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
      <ScreenHeader
        center={<ScreenHeaderTitle>Get Replies</ScreenHeaderTitle>}
        left={<HeaderBackButton onPress={onBack} />}
      />
      <StageColumn
        footer={
          <Animated.View
            pointerEvents={isInteractive ? "auto" : "none"}
            style={[
              styles.card,
              {
                opacity: footerOpacity,
                transform: [{ scale: footerScale }],
              },
            ]}
          >
            <ActionButton
              label="Change Screenshot"
              leading={
                <GalleryRemove color={colors.stone200} size={iconSizes.md} />
              }
              onPress={onChangeScreenshot}
              variant="secondary"
            />
            <ActionButton
              label="Get Replies"
              onPress={() => {
                void Haptics.impactAsync(
                  Haptics.ImpactFeedbackStyle.Light,
                ).catch(() => {});
                onGetReplies();
              }}
              trailing={
                <ArrowRight color={colors.stone50} size={iconSizes.md} />
              }
              variant="primary"
            />
            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage}
              </Text>
            ) : null}
          </Animated.View>
        }
        stage={
          <>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              source={STAGE_BACKDROP}
              style={styles.stageImage}
            />
            {selectedScreenshotUri ? (
              <View style={styles.screenshotArea}>
                <FittedScreenshot
                  animatedStyle={{
                    opacity: screenshotOpacity,
                    transform: [
                      { scale: screenshotScale },
                      { translateY: screenshotTranslateY },
                    ],
                  }}
                  frameRef={screenshotFrameRef}
                  hidden={isScreenshotHidden}
                  onError={handleScreenshotReady}
                  onLoad={handleScreenshotReady}
                  shadow
                  uri={selectedScreenshotUri}
                />
                <Pressable
                  accessibilityLabel="Preview screenshot"
                  accessibilityRole="button"
                  disabled={!isInteractive}
                  onPress={openPreview}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No screenshot selected</Text>
              </View>
            )}
          </>
        }
      />
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
  stageImage: {
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  card: {
    backgroundColor: colors.stone900,
    borderRadius: radii.lg,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  empty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  emptyText: {
    ...typography.body,
    color: colors.stone200,
    textAlign: "center",
  },
  error: {
    ...typography.body,
    color: colors.red400,
    textAlign: "center",
  },
  screen: { backgroundColor: colors.background, flex: 1 },
  screenshotArea: {
    ...StyleSheet.absoluteFillObject,
    paddingBottom: STAGE_PADDING.bottom,
    paddingHorizontal: STAGE_PADDING.horizontal,
    paddingTop: STAGE_PADDING.top,
  },
});
