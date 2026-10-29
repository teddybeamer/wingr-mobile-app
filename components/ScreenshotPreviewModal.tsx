import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { fitWithin } from "../lib/fit-within";
import { getPreviewTransition, type Rect } from "../lib/preview-transition";
import { colors, spacing, typography } from "../theme";
import {
  SCREENSHOT_RADIUS,
  ScreenshotFrame,
  useScreenshotAspectRatio,
} from "./FittedScreenshot";

// Same space on every side of the screenshot inside the card.
const CARD_PADDING = 14;
const HEADER_HEIGHT = 32;
const CARD_GAP = 11;
// Keeps the title readable when a very narrow screenshot makes the card hug it.
const CARD_MIN_WIDTH = 280;

// Opening and closing use the same timing and curve, so the motion out is the
// exact mirror of the motion in.
const TRANSITION_DURATION = 280;
const TRANSITION_EASING = Easing.bezier(0.4, 0, 0.2, 1);

export type WindowRect = Rect;

// View-only full-screen look at the chosen screenshot. There is deliberately no
// change or delete here; those live on the Screenshot Chosen screen.
//
// The card wraps the screenshot (up to the available space), so the padding
// around it is the same on all sides whatever the screenshot's shape. When
// `sourceRect` (the screenshot's place on the previous screen, in window
// coordinates) is given, the screenshot flies from there into the card and back
// on close. The motion uses only transforms and opacity on the native driver,
// plus the picture's corner radius, which is counter-scaled so it stays 21 px
// the whole way instead of shrinking with the scale.
export function ScreenshotPreviewModal({
  onClose,
  onClosed,
  onOpening,
  sourceRect,
  uri,
  visible,
}: {
  onClose: () => void;
  // The closing motion has finished: the previous screen may show it again.
  onClosed?: () => void;
  // The opening motion is about to start: the previous screen should hide its
  // copy of the screenshot so there is only one.
  onOpening?: () => void;
  sourceRect?: WindowRect | null;
  uri: string | null;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(false);
  // The motion starts only after the screenshot has loaded; decoding a large
  // image mid-flight makes the first frames stutter.
  const [imageReady, setImageReady] = useState(false);
  const [available, setAvailable] = useState({
    height: 0,
    width: 0,
    x: 0,
    y: 0,
  });
  const aspectRatio = useScreenshotAspectRatio(presented ? uri : null);
  const progress = useRef(new Animated.Value(0)).current;
  const radiusProgress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const openedRef = useRef(false);
  const callbacksRef = useRef({ onClosed, onOpening });
  callbacksRef.current = { onClosed, onOpening };

  useEffect(() => {
    if (visible && uri) setPresented(true);
  }, [uri, visible]);

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width, x, y } = nativeEvent.layout;
    setAvailable((current) =>
      Math.abs(current.height - height) < 0.5 &&
      Math.abs(current.width - width) < 0.5 &&
      Math.abs(current.x - x) < 0.5 &&
      Math.abs(current.y - y) < 0.5
        ? current
        : { height, width, x, y },
    );
  };

  const size = fitWithin(
    {
      height: available.height - CARD_PADDING * 2 - HEADER_HEIGHT - CARD_GAP,
      width: available.width - CARD_PADDING * 2,
    },
    aspectRatio,
  );
  const ready = presented && imageReady && size !== null && available.width > 0;

  // Final layout of the card and the screenshot inside it, and the transform
  // that maps them onto the source rect (see lib/preview-transition).
  const cardWidth = size
    ? Math.min(
        available.width,
        Math.max(size.width + CARD_PADDING * 2, CARD_MIN_WIDTH),
      )
    : available.width;
  const transition = size
    ? getPreviewTransition({
        area: available,
        cardPadding: CARD_PADDING,
        cardWidth,
        gap: CARD_GAP,
        headerHeight: HEADER_HEIGHT,
        size,
        source: sourceRect ?? null,
      })
    : null;

  const animateTo = (toValue: 0 | 1, onDone?: () => void) => {
    animationRef.current?.stop();
    animationRef.current = Animated.parallel([
      Animated.timing(progress, {
        duration: TRANSITION_DURATION,
        easing: TRANSITION_EASING,
        toValue,
        useNativeDriver: true,
      }),
      Animated.timing(radiusProgress, {
        duration: TRANSITION_DURATION,
        easing: TRANSITION_EASING,
        toValue,
        useNativeDriver: false,
      }),
    ]);
    animationRef.current.start(({ finished }) => {
      if (finished) onDone?.();
    });
  };

  // Open once the card's final size is known and the screenshot has loaded. The
  // frame of delay lets the first paint of the card at the source position
  // settle before anything moves.
  useEffect(() => {
    if (!ready || !visible || openedRef.current) return;
    const frame = requestAnimationFrame(() => {
      openedRef.current = true;
      callbacksRef.current.onOpening?.();
      animateTo(1);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, visible]);

  // Close: fly back, then let the previous screen show its copy again.
  useEffect(() => {
    if (visible) return;
    if (!openedRef.current) {
      // Closed before the motion ever started: nothing to fly back.
      setPresented(false);
      setImageReady(false);
      return;
    }
    animateTo(0, () => {
      openedRef.current = false;
      callbacksRef.current.onClosed?.();
      setPresented(false);
      setImageReady(false);
    });
  }, [visible]);

  // Reopened while still flying back: turn around.
  useEffect(() => {
    if (visible && openedRef.current) animateTo(1);
  }, [visible]);

  useEffect(() => () => animationRef.current?.stop(), []);

  const chromeOpacity = progress.interpolate({
    extrapolate: "clamp",
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0, 1],
  });
  const headerOpacity = progress.interpolate({
    extrapolate: "clamp",
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });
  const clipRadius = radiusProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      transition ? SCREENSHOT_RADIUS / transition.scale : SCREENSHOT_RADIUS,
      SCREENSHOT_RADIUS,
    ],
  });

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={presented}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, { opacity: progress }]}
      />
      {/* Tapping outside the card closes it. */}
      <Pressable
        accessibilityLabel="Close preview"
        accessibilityRole="button"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.scrim,
          {
            // Same 16 px gutter at the bottom as on the sides.
            paddingBottom: spacing.xl,
            paddingTop: insets.top + spacing.md,
          },
        ]}
      >
        {/* Measured without the scrim's own padding. */}
        <View
          onLayout={handleLayout}
          pointerEvents="box-none"
          style={styles.area}
        >
          {size && uri && transition ? (
            <Animated.View
              style={[
                styles.card,
                { width: cardWidth },
                {
                  transform: [
                    {
                      translateX: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [transition.translateX, 0],
                      }),
                    },
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [transition.translateY, 0],
                      }),
                    },
                    {
                      scale: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [transition.scale, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Animated.View
                pointerEvents="none"
                style={[styles.cardBackground, { opacity: chromeOpacity }]}
              />
              <Animated.View
                style={[styles.header, { opacity: headerOpacity }]}
              >
                <Pressable
                  accessibilityLabel="Close preview"
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={onClose}
                  style={styles.closeButton}
                >
                  <Svg height={24} viewBox="0 0 24 24" width={24}>
                    <Path
                      d="M6 6l12 12M18 6L6 18"
                      fill="none"
                      stroke={colors.stone50}
                      strokeLinecap="round"
                      strokeWidth={2}
                    />
                  </Svg>
                </Pressable>
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={styles.title}
                >
                  Screenshot Preview
                </Text>
                {/* Invisible: keeps the title centred over the close button. */}
                <View style={styles.headerSpacer} />
              </Animated.View>
              <ScreenshotFrame
                clipRadius={clipRadius}
                onError={() => setImageReady(true)}
                onLoad={() => setImageReady(true)}
                size={size}
                uri={uri}
              />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  area: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    justifyContent: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.stone950,
  },
  card: {
    alignItems: "center",
    borderRadius: 22,
    gap: CARD_GAP,
    padding: CARD_PADDING,
  },
  cardBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.stone500,
    borderRadius: 22,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: colors.stone700,
    borderRadius: HEADER_HEIGHT / 2,
    height: HEADER_HEIGHT,
    justifyContent: "center",
    width: HEADER_HEIGHT,
  },
  header: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerSpacer: { height: HEADER_HEIGHT, width: HEADER_HEIGHT },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.titleSemibold16,
    color: "#FFFFFF",
    flexShrink: 1,
    fontSize: 17,
  },
});
