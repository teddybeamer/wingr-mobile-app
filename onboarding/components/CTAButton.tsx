import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type CTAButtonProps = {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

export function CTAButton({ disabled = false, label, loading, onPress, variant = 'primary' }: CTAButtonProps) {
  const secondary = variant === 'secondary';
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
            disabled && styles.inactiveSurface,
            pressed && !inactive && styles.pressedSurface,
            loading && styles.loadingSurface,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.label}>{label}</Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inactiveSurface: {
    backgroundColor: '#5A5A5A',
  },
  label: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
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
    backgroundColor: '#1970FD',
    borderRadius: 999,
    height: 60,
    justifyContent: 'center',
    width: '100%',
  },
});
