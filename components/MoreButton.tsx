import { MenuDots } from "@solar-icons/react-native/Bold";
import {
  StyleSheet,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export function MoreButton({
  expanded,
  onPress,
  style,
}: {
  expanded: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel="More options"
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      activeOpacity={0.6}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <MenuDots color="#A3A3A3" size={24} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 8,
    width: 44,
  },
});
