import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { layout } from "../theme";

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

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    height: layout.headerHeight,
    justifyContent: "center",
  },
});
