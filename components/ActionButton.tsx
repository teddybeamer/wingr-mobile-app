import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

import { colors, radii, spacing, typography } from "../theme";

// Full-width button from the redesign: 12 px padding, 12 px radius, 6 px gap
// between label and icon. The height is fixed by padding and a 44 px minimum,
// so it does not change with screen width.
export function ActionButton({
  accessibilityLabel,
  disabled = false,
  label,
  leading,
  onPress,
  trailing,
  variant,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  label: string;
  leading?: ReactNode;
  onPress: () => void;
  trailing?: ReactNode;
  variant: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        isPrimary ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      {leading}
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={[
          styles.label,
          isPrimary ? styles.labelPrimary : styles.labelSecondary,
        ]}
      >
        {label}
      </Text>
      {trailing}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.sm,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 44,
    padding: spacing.lg,
    width: "100%",
  },
  disabled: { opacity: 0.6 },
  label: { ...typography.titleSemibold16, flexShrink: 1 },
  labelPrimary: { color: colors.stone50 },
  labelSecondary: { color: colors.stone200 },
  primary: { backgroundColor: colors.primaryBlue },
  secondary: { backgroundColor: colors.stone700 },
});
