import { type Ref, useEffect, useState } from "react";
import {
  Animated,
  Image,
  type LayoutChangeEvent,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { fitWithin } from "../lib/fit-within";

export const SCREENSHOT_RADIUS = 21;
const FALLBACK_ASPECT_RATIO = 9 / 19.5;

// The ratio comes from getSize rather than the load event: it behaves the same
// on every platform. Callers mount the <Image> only once their final size is
// known. On iOS an image mounted at a tiny size is decoded at that size and
// then stretched (a 1 x 1 placeholder produced a blurry blob), and that
// downsized copy would also be what getSize reports.
export function useScreenshotAspectRatio(uri: string | null) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    setAspectRatio(null);
    if (!uri) return;

    let cancelled = false;
    Image.getSize(
      uri,
      (width, height) => {
        if (!cancelled && width > 0 && height > 0) {
          setAspectRatio(width / height);
        }
      },
      () => {
        // Could not read the size: show it at a typical phone ratio and let
        // the image report its own error.
        if (!cancelled) setAspectRatio(FALLBACK_ASPECT_RATIO);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return aspectRatio;
}

// A screenshot at an exact size, with rounded corners and an optional soft
// shadow. Never cropped or stretched as long as `size` has the image's ratio.
export function ScreenshotFrame({
  animatedStyle,
  clipRadius = SCREENSHOT_RADIUS,
  frameRef,
  hidden = false,
  onError,
  onLoad,
  shadow = false,
  size,
  uri,
}: {
  animatedStyle?: Animated.WithAnimatedObject<ViewStyle>;
  // Corner radius of the picture; animatable for the preview transition.
  clipRadius?: number | Animated.AnimatedInterpolation<number>;
  // Lets a caller measure where the screenshot is on screen.
  frameRef?: Ref<View>;
  // Invisible but still laid out (used while the preview shows it elsewhere).
  hidden?: boolean;
  onError?: () => void;
  onLoad?: () => void;
  shadow?: boolean;
  size: { height: number; width: number };
  uri: string;
}) {
  return (
    <Animated.View
      collapsable={false}
      ref={frameRef}
      style={[
        styles.frame,
        shadow && styles.shadow,
        animatedStyle,
        hidden && styles.invisible,
        size,
      ]}
    >
      <Animated.View style={[styles.clip, { borderRadius: clipRadius }]}>
        <Animated.Image
          accessibilityIgnoresInvertColors
          onError={onError}
          onLoad={onLoad}
          resizeMode="cover"
          source={{ uri }}
          style={styles.image}
        />
      </Animated.View>
    </Animated.View>
  );
}

// A screenshot shown whole inside whatever box the parent gives it (flex); this
// only measures that box.
export function FittedScreenshot({
  animatedStyle,
  frameRef,
  hidden,
  onError,
  onLoad,
  shadow = false,
  uri,
}: {
  animatedStyle?: Animated.WithAnimatedObject<ViewStyle>;
  frameRef?: Ref<View>;
  hidden?: boolean;
  onError?: () => void;
  onLoad?: () => void;
  shadow?: boolean;
  uri: string;
}) {
  const [box, setBox] = useState({ height: 0, width: 0 });
  const aspectRatio = useScreenshotAspectRatio(uri);
  const size = fitWithin(box, aspectRatio);

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;
    setBox((current) =>
      Math.abs(current.height - height) < 0.5 &&
      Math.abs(current.width - width) < 0.5
        ? current
        : { height, width },
    );
  };

  return (
    <View onLayout={handleLayout} style={styles.box}>
      {size ? (
        <ScreenshotFrame
          animatedStyle={animatedStyle}
          frameRef={frameRef}
          hidden={hidden}
          onError={onError}
          onLoad={onLoad}
          shadow={shadow}
          size={size}
          uri={uri}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  clip: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  frame: { borderRadius: SCREENSHOT_RADIUS },
  image: { height: "100%", width: "100%" },
  invisible: { opacity: 0 },
  // Soft black shadow so the screenshot lifts off the textured backdrop.
  shadow: {
    backgroundColor: "#000000",
    elevation: 12,
    shadowColor: "#000000",
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 14,
  },
});
