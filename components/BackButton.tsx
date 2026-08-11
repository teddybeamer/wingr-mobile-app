import { ArrowLeft } from "@solar-icons/react-native/Linear";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import {
  StyleSheet,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from "react-native";

const BACK_BUTTON_SIZE = 36;
const BACK_BUTTON_RADIUS = BACK_BUTTON_SIZE / 2;

type BackButtonProps = {
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

export function BackButton({
  accessibilityLabel = "Go back",
  disabled = false,
  onPress,
  style,
}: BackButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={[styles.button, style]}
    >
      <Svg
        height={BACK_BUTTON_SIZE}
        pointerEvents="none"
        style={styles.gradientBorder}
        width={BACK_BUTTON_SIZE}
      >
        <Defs>
          <LinearGradient
            id="back-button-gradient"
            x1="0%"
            x2="0%"
            y1="0%"
            y2="100%"
          >
            <Stop offset="0%" stopColor="#525252" />
            <Stop offset="100%" stopColor="#525252" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect
          fill="none"
          height={BACK_BUTTON_SIZE - 1}
          rx={BACK_BUTTON_RADIUS}
          ry={BACK_BUTTON_RADIUS}
          stroke="url(#back-button-gradient)"
          strokeWidth="1"
          width={BACK_BUTTON_SIZE - 1}
          x="0.5"
          y="0.5"
        />
      </Svg>
      <ArrowLeft color="#F5F5F5" size={24} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#404040",
    borderRadius: BACK_BUTTON_RADIUS,
    height: BACK_BUTTON_SIZE,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: BACK_BUTTON_SIZE,
  },
  gradientBorder: {
    left: 0,
    position: "absolute",
    top: 0,
  },
});
