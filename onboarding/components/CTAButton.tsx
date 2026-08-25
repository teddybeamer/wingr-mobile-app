import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type CTAButtonProps = {
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'indigo';
};

export function CTAButton({ disabled = false, icon, label, loading, onPress, variant = 'primary' }: CTAButtonProps) {
  const secondary = variant === 'secondary';
  const indigo = variant === 'indigo';
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={styles.pressable}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.surface,
            secondary && styles.secondarySurface,
            indigo && styles.indigoSurface,
            disabled && styles.inactiveSurface,
            pressed && !inactive && styles.pressedSurface,
            loading && styles.loadingSurface,
          ]}
        >
          {indigo ? <IndigoGradientBorder /> : null}
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.labelContent}>
              {icon}
              <Text style={styles.label}>{label}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function IndigoGradientBorder() {
  return (
    <Svg height="60" pointerEvents="none" style={styles.gradientBorder} width="100%">
      <Defs>
        <LinearGradient id="onboarding-indigo-cta-border" x1="0%" x2="0%" y1="0%" y2="100%">
          <Stop offset="0%" stopColor="#2563EB" />
          <Stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect
        fill="none"
        height="59"
        rx="29.5"
        ry="29.5"
        stroke="url(#onboarding-indigo-cta-border)"
        strokeWidth="1"
        width="99.75%"
        x="0.5"
        y="0.5"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  inactiveSurface: {
    backgroundColor: '#5A5A5A',
  },
  gradientBorder: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  indigoSurface: {
    backgroundColor: '#1D4ED8',
  },
  label: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
  labelContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  loadingSurface: {
    opacity: 0.72,
  },
  pressable: {
    width: '100%',
  },
  pressedSurface: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  secondarySurface: {
    backgroundColor: '#333337',
  },
  surface: {
    alignItems: 'center',
    backgroundColor: '#1D4ED8',
    borderRadius: 999,
    height: 60,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
});
