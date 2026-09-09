import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function BottomSheet({
  children,
  onClose,
  onClosed,
  visible,
  title,
  titleColor = "#F5F5F5",
  showHandle = true,
  panelStyle,
  bottomPadding = 34,
}: {
  children: ReactNode;
  onClose: () => void;
  onClosed?: () => void;
  visible: boolean;
  title: string;
  titleColor?: string;
  showHandle?: boolean;
  panelStyle?: StyleProp<ViewStyle>;
  bottomPadding?: number;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isPresented, setIsPresented] = useState(visible);
  const isPresentedRef = useRef(visible);
  const sheetTravelDistanceRef = useRef(windowHeight);
  const onClosedRef = useRef(onClosed);
  const visibleRef = useRef(visible);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(windowHeight)).current;
  onClosedRef.current = onClosed;
  visibleRef.current = visible;

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
            duration: 180,
            easing: Easing.out(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(sheetTranslateY, {
            duration: 280,
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
          duration: 140,
          easing: Easing.in(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          duration: 220,
          easing: Easing.in(Easing.cubic),
          toValue: sheetTravelDistance,
          useNativeDriver: true,
        }),
      ]);
      animation.start(({ finished }) => {
        if (finished) {
          isPresentedRef.current = false;
          setIsPresented(false);
          // iOS waits for native Modal dismissal before opening another app.
          if (Platform.OS !== "ios") {
            animationFrame = requestAnimationFrame(() => {
              if (!visibleRef.current) onClosedRef.current?.();
            });
          }
        }
      });
    }
    return () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animation?.stop();
    };
  }, [backdropOpacity, sheetTranslateY, visible]);

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      onDismiss={() => {
        if (Platform.OS === "ios" && !visibleRef.current)
          onClosedRef.current?.();
      }}
      transparent
      visible={isPresented}
    >
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable
          accessibilityLabel={`Close ${title} sheet`}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.panelAnimation,
            {
              maxHeight: windowHeight - insets.top,
              transform: [{ translateY: sheetTranslateY }],
            },
          ]}
        >
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={[
              styles.panel,
              panelStyle,
              { paddingBottom: Math.max(bottomPadding, insets.bottom) },
            ]}
          >
            {showHandle ? <View style={styles.handle} /> : null}
            <Text accessibilityRole="header" style={[styles.title, { color: titleColor }]}>
              {title}
            </Text>
            {children}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.58)",
    flex: 1,
    justifyContent: "flex-end",
  },
  panelAnimation: { width: "100%" },
  scroll: { flexGrow: 0 },
  panel: {
    backgroundColor: "#111113",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    gap: 18,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "#4A4A50",
    borderRadius: 999,
    height: 5,
    width: 48,
  },
  title: {
    color: "#F5F5F5",
    fontFamily: "ClashDisplay",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
});
