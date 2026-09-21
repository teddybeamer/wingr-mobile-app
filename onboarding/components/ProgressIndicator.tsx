import { StyleSheet, View } from 'react-native';

type ProgressIndicatorProps = {
  activeColor?: string;
  currentIndex: number;
  trackColor?: string;
  totalSteps: number;
};

export function ProgressIndicator({
  activeColor,
  currentIndex,
  trackColor,
  totalSteps,
}: ProgressIndicatorProps) {
  const progress = totalSteps > 1 ? (currentIndex + 1) / totalSteps : 1;

  return (
    <View
      accessibilityLabel={`Onboarding step ${currentIndex + 1} of ${totalSteps}`}
      style={[styles.track, trackColor && { backgroundColor: trackColor }]}
    >
      <View
        style={[
          styles.activeSegment,
          activeColor && { backgroundColor: activeColor },
          { width: `${Math.max(progress * 100, 10)}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  activeSegment: {
    backgroundColor: '#9A9A9A',
    borderRadius: 999,
    height: 4,
  },
  track: {
    backgroundColor: '#565656',
    borderRadius: 999,
    flex: 1,
    height: 4,
    overflow: 'hidden',
    width: '100%',
  },
});
