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

import { layout, radii, spacing, surfaces } from "../theme";

const ENTER_DURATION = 240;
const EXIT_DURATION = 180;
const DIALOG_GUTTER = 32;
const DIALOG_MAX_WIDTH = 400;

// Centred light dialog over a dimmed screen (the redesigned error and tips
// dialogs). It hangs just below the header area, like the Figma frames, and its
// content scrolls only if the screen is too short to show it all.
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
  const [presented, setPresented] = useState(visible);
  const presentedRef = useRef(visible);
  const visibleRef = useRef(visible);
  const onClosedRef = useRef(onClosed);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  onClosedRef.current = onClosed;
  visibleRef.current = visible;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    let frame: number | null = null;

    if (visible) {
      if (!presentedRef.current) {
        presentedRef.current = true;
        progress.setValue(0);
        setPresented(true);
      }
      frame = requestAnimationFrame(() => {
        animation = Animated.timing(progress, {
          duration: ENTER_DURATION,
          easing: Easing.bezier(0.2, 0.9, 0.25, 1),
          toValue: 1,
          useNativeDriver: true,
        });
        animation.start();
      });
    } else if (presentedRef.current) {
      animation = Animated.timing(progress, {
        duration: EXIT_DURATION,
        easing: Easing.in(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      });
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
  }, [progress, visible]);

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
            paddingBottom: Math.max(insets.bottom, spacing.xl),
            paddingTop: insets.top + layout.headerHeight,
          },
        ]}
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [14, 0],
                  }),
                },
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
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
    paddingHorizontal: DIALOG_GUTTER,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
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
