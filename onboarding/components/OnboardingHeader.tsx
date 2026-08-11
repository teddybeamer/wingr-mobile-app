import { BackButton } from '../../components/BackButton';
import { StyleSheet, View } from 'react-native';
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
      <BackButton
        accessibilityLabel="Go back"
        disabled={!canGoBack}
        onPress={onBack}
        style={!canGoBack ? styles.hiddenButton : undefined}
      />

      <ProgressIndicator currentIndex={currentIndex} totalSteps={totalSteps} />
      <View style={styles.endSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  endSpacer: {
    width: 36,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 21,
    height: 36,
  },
  hiddenButton: {
    opacity: 0,
  },
});
