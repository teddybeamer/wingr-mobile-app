import { Copy, StarsMinimalistic } from '@solar-icons/react-native/Linear';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function RepliesScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.replyCard}>
        <View style={styles.badge}>
          <StarsMinimalistic color="#5D90FF" size={16} />
          <Text style={styles.badgeText}>Recommended</Text>
        </View>

        <Text style={styles.replyText}>
          "Damn... You're slowly becoming my favorite notification"
        </Text>

        <View style={styles.whyCopy}>
          <Text style={styles.whyTitle}>Why it works:</Text>
          <Text style={styles.whyBody}>Playful, but doesn't over-invest.</Text>
        </View>

        <View style={styles.copyButton}>
          <Copy color="#FFFFFF" size={20} />
          <Text style={styles.copyText}>Copy</Text>
        </View>
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#18306C',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    height: 24,
    paddingHorizontal: 10,
  },
  badgeText: {
    color: '#5D90FF',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 13,
    lineHeight: 16,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: '#4B4B4B',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    height: 41,
    justifyContent: 'center',
    marginTop: 26,
  },
  copyText: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 22,
  },
  replyCard: {
    backgroundColor: '#0B111E',
    borderColor: '#1970FD',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 182,
    padding: 10,
  },
  replyText: {
    color: '#FFFFFF',
    fontFamily: 'ClashDisplay',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    marginHorizontal: 40,
    marginTop: 30,
  },
  whyBody: {
    color: '#D7D7D7',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 17,
    lineHeight: 21,
  },
  whyCopy: {
    marginHorizontal: 40,
    marginTop: 28,
  },
  whyTitle: {
    color: '#D7D7D7',
    fontFamily: 'ClashGrotesk',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 21,
  },
});
