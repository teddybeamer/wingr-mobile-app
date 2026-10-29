import { ArrowLeft } from "@solar-icons/react-native/Linear";
import { StyleSheet, TouchableOpacity } from "react-native";

import { colors, iconSizes } from "../theme";

// Plain arrow for the redesigned headers. Positioned like MoreButton (44 px
// touch target, icon 16 px from the screen edge) inside a ScreenHeader.
export function HeaderBackButton({
  accessibilityLabel = "Go back",
  onPress,
}: {
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      activeOpacity={0.6}
      onPress={onPress}
      style={styles.button}
    >
      <ArrowLeft color={colors.neutral300} size={iconSizes.lg} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    left: 6,
    position: "absolute",
    top: 8,
    width: 44,
  },
});
