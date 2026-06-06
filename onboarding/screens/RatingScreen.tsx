import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function RatingScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.illustrationWrap}>
        <View style={styles.shadowCard} />
        <View style={styles.card}>
          <Text style={styles.cardTitle}>It landed me{'\n'}a date 😂😂👍</Text>
          <Text style={styles.cardSubtitle}>User from TikTok</Text>
        </View>
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#2854DB',
    borderRadius: 14,
    height: 124,
    justifyContent: 'center',
    paddingLeft: 32,
    transform: [{ rotate: '31deg' }, { skewX: '-8deg' }],
    width: 244,
  },
  cardSubtitle: {
    color: '#B7C9FF',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 16,
    lineHeight: 20,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontFamily: 'ClashDisplay',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  illustrationWrap: {
    alignItems: 'center',
    height: 285,
    justifyContent: 'center',
    marginTop: 130,
  },
  shadowCard: {
    backgroundColor: '#11183C',
    borderColor: '#4A91FF',
    borderRadius: 16,
    borderRightWidth: 8,
    borderTopWidth: 6,
    height: 168,
    position: 'absolute',
    transform: [{ rotate: '31deg' }, { skewX: '-8deg' }],
    width: 292,
  },
});
