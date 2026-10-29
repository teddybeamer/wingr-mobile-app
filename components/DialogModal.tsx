import { BlurView } from "expo-blur";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radii, spacing, surfaces } from "../theme";

const ENTER_DURATION = 280;
// The dialog itself grows from the middle with a small overshoot while the blur
// fades in; it keeps its own, longer timing so the overshoot can settle.
const GROW_DURATION = 360;
const GROW_START_SCALE = 0.8;
const EXIT_DURATION = 180;
const DIALOG_GUTTER = 32;
const DIALOG_MAX_WIDTH = 400;
// Everything behind the dialog is blurred (the Figma "background blur"), with a
// faint stone/900 layer on top. Tune the strength here.
const BLUR_INTENSITY = 30;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

// Centred light dialog over a dimmed screen (the redesigned error and tips
// dialogs), vertically centred on the screen. Its content scrolls only if the
// screen is too short to show it all.
//
// `onClosed` fires once the modal is fully gone. On iOS that is the native
// dismissal: another system UI (the photo picker) cannot be opened while a
// modal is still presented.
export function DialogModal({
  children,
  onClose,
  onClosed,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  onClosed?: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const verticalInset = Math.max(insets.top, insets.bottom) + spacing.xl;
  const [presented, setPresented] = useState(visible);
  const presentedRef = useRef(visible);
  const visibleRef = useRef(visible);
  const onClosedRef = useRef(onClosed);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  // The blur strength cannot use the native driver, so it has its own value
  // that runs in step with `progress`.
  const blurProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const grow = useRef(new Animated.Value(visible ? 1 : 0)).current;
  onClosedRef.current = onClosed;
  visibleRef.current = visible;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    let frame: number | null = null;

    if (visible) {
      if (!presentedRef.current) {
        presentedRef.current = true;
        progress.setValue(0);
        blurProgress.setValue(0);
        grow.setValue(0);
        setPresented(true);
      }
      frame = requestAnimationFrame(() => {
        const easing = Easing.bezier(0.2, 0.9, 0.25, 1);
        animation = Animated.parallel([
          Animated.timing(progress, {
            duration: ENTER_DURATION,
            easing,
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(blurProgress, {
            duration: ENTER_DURATION,
            easing,
            toValue: 1,
            useNativeDriver: false,
          }),
          Animated.timing(grow, {
            duration: GROW_DURATION,
            easing: Easing.bezier(0.34, 1.45, 0.64, 1),
            toValue: 1,
            useNativeDriver: true,
          }),
        ]);
        animation.start();
      });
    } else if (presentedRef.current) {
      animation = Animated.parallel([
        Animated.timing(progress, {
          duration: EXIT_DURATION,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(blurProgress, {
          duration: EXIT_DURATION,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: false,
        }),
        Animated.timing(grow, {
          duration: EXIT_DURATION,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]);
      animation.start(({ finished }) => {
        if (!finished) return;
        presentedRef.current = false;
        setPresented(false);
        if (Platform.OS !== "ios") {
          frame = requestAnimationFrame(() => {
            if (!visibleRef.current) onClosedRef.current?.();
          });
        }
      });
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      animation?.stop();
    };
  }, [blurProgress, grow, progress, visible]);

  return (
    <Modal
      animationType="none"
      onDismiss={() => {
        if (Platform.OS === "ios" && !visibleRef.current) {
          onClosedRef.current?.();
        }
      }}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={presented}
    >
      <AnimatedBlurView
        experimentalBlurMethod="dimezisBlurView"
        intensity={blurProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, BLUR_INTENSITY],
        })}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        tint="dark"
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, { opacity: progress }]}
      />
      {/* Tapping outside the dialog closes it. */}
      <Pressable
        accessibilityLabel="Close dialog"
        accessibilityRole="button"
        onPress={onClose}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.area,
          {
            // Same space above and below, so the dialog sits in the middle of
            // the screen; a tall dialog scrolls instead of touching the edges.
            paddingBottom: verticalInset,
            paddingTop: verticalInset,
          },
        ]}
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              // Fades in quickly, then grows from the middle.
              opacity: progress.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, 1, 1],
              }),
              transform: [
                {
                  scale: grow.interpolate({
                    inputRange: [0, 1],
                    outputRange: [GROW_START_SCALE, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  area: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: DIALOG_GUTTER,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: surfaces.dialogBackdrop,
  },
  content: { padding: spacing.md },
  dialog: {
    backgroundColor: surfaces.dialog,
    borderRadius: radii.lg,
    flexShrink: 1,
    maxWidth: DIALOG_MAX_WIDTH,
    overflow: "hidden",
    width: "100%",
  },
  scroll: { flexGrow: 0 },
});
