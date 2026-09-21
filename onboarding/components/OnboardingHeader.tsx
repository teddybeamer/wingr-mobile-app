import { BackButton } from '../../components/BackButton';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProgressIndicator } from './ProgressIndicator';

type OnboardingHeaderProps = {
  appearance?: 'default' | 'paywall';
  canGoBack: boolean;
  currentIndex: number;
  onBack: () => void;
  rightAccessory?: ReactNode;
  totalSteps: number;
};

export function OnboardingHeader({
  appearance = 'default',
  canGoBack,
  currentIndex,
  onBack,
  rightAccessory,
  totalSteps,
}: OnboardingHeaderProps) {
  const paywall = appearance === 'paywall';

  return (
    <View style={[styles.header, paywall && styles.paywallHeader]}>
      <BackButton
        accessibilityLabel="Go back"
        disabled={!canGoBack}
        minimal={paywall}
        onPress={onBack}
        style={!canGoBack ? styles.hiddenButton : undefined}
      />

      <ProgressIndicator
        activeColor={paywall ? '#737373' : undefined}
        currentIndex={currentIndex}
        totalSteps={totalSteps}
        trackColor={paywall ? '#404040' : undefined}
      />
      <View style={[styles.endSpacer, paywall && styles.paywallEndSpacer]} />
      {rightAccessory}
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
  paywallEndSpacer: {
    width: 24,
  },
  paywallHeader: {
    gap: 23,
    height: 48,
  },
  hiddenButton: {
    opacity: 0,
  },
});
