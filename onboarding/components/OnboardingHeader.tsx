import { ArrowLeft } from '@solar-icons/react-native/Linear';
import { Pressable, StyleSheet, View } from 'react-native';
import { ProgressIndicator } from './ProgressIndicator';

type OnboardingHeaderProps = {
  canGoBack: boolean;
  currentIndex: number;
  onBack: () => void;
  totalSteps: number;
};

export function OnboardingHeader({ canGoBack, currentIndex, onBack, totalSteps }: OnboardingHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        disabled={!canGoBack}
        hitSlop={12}
        onPress={onBack}
        style={[styles.iconButton, !canGoBack && styles.hiddenButton]}
      >
        <ArrowLeft color="#D7D7D7" size={28} />
      </Pressable>

      <ProgressIndicator currentIndex={currentIndex} totalSteps={totalSteps} />
      <View style={styles.endSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  endSpacer: {
    width: 22,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 21,
    height: 34,
  },
  hiddenButton: {
    opacity: 0,
  },
  iconButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 42,
  },
});
