import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { colors, spacing, typography } from "../theme";
import { WingrLogoMark } from "./WingrLogoMark";

export const CHAT_AVATAR_SIZE = 39;
export const CHAT_BUBBLE_RADIUS = 10;

// ". . ." as a wave: each dot brightens a moment after the one before it.
export function TypingDots() {
  const dots = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const wave = Animated.loop(
      Animated.stagger(
        160,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              duration: 260,
              toValue: 1,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              duration: 260,
              toValue: 0.35,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    wave.start();
    return () => wave.stop();
  }, [dots]);

  return (
    <View style={styles.dots}>
      {dots.map((opacity, index) => (
        <Animated.Text
          key={index}
          maxFontSizeMultiplier={1.2}
          style={[styles.dot, { opacity }]}
        >
          .
        </Animated.Text>
      ))}
    </View>
  );
}

// WiNGR "typing" in a chat: its avatar and a bubble with the animated dots,
// popping in. The loading screen and the Get Replies feed (while a new reply is
// being generated) show the same thing.
export function WingrTypingBubble({
  onLayout,
}: {
  onLayout?: React.ComponentProps<typeof Animated.View>["onLayout"];
}) {
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(appear, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [appear]);

  return (
    <Animated.View
      accessible
      accessibilityLabel="WiNGR is typing"
      onLayout={onLayout}
      style={[
        styles.row,
        {
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
            {
              scale: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [0.94, 1],
              }),
            },
          ],
        },
      ]}
    >
      <WingrLogoMark size={CHAT_AVATAR_SIZE} />
      <View style={styles.bubble}>
        <TypingDots />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    backgroundColor: colors.stone800,
    borderBottomLeftRadius: CHAT_BUBBLE_RADIUS,
    borderBottomRightRadius: CHAT_BUBBLE_RADIUS,
    borderTopRightRadius: CHAT_BUBBLE_RADIUS,
    justifyContent: "center",
    minHeight: CHAT_AVATAR_SIZE,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dot: { ...typography.chatMessage, color: colors.stone500 },
  dots: { flexDirection: "row", gap: spacing.xs },
  row: { alignSelf: "flex-start", flexDirection: "row", gap: spacing.xs },
});
