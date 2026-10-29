import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, layout, typography } from "../theme";

// 60 px header shared by the redesigned screens. The centre content is laid
// out by flex; side controls (MoreButton, back arrow) position themselves
// absolutely in their own 44 px touch target.
export function ScreenHeader({
  center,
  left,
  right,
}: {
  center?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {center}
      {left}
      {right}
    </View>
  );
}

export function ScreenHeaderTitle({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.2}
      numberOfLines={1}
      style={styles.title}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    height: layout.headerHeight,
    justifyContent: "center",
  },
  title: {
    ...typography.titleSemibold16,
    color: colors.stone300,
    // Keep clear of the 44 px side controls.
    maxWidth: "70%",
  },
});
