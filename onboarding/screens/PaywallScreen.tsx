import { StarsMinimalistic } from '@solar-icons/react-native/Linear';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function PaywallScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.quoteCard}>
        <View style={styles.badge}>
          <StarsMinimalistic color="#5D90FF" size={16} />
          <Text style={styles.badgeText}>Recommended</Text>
        </View>
        <Text style={styles.quote}>
          "Damn... You're slowly becoming my favorite notification"
        </Text>
      </View>

      <View style={styles.plans}>
        <View style={styles.planCard}>
          <Text style={styles.planName}>Weekly Plan</Text>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$9.99/week</Text>
            <Text style={styles.trial}>3-day free trial</Text>
          </View>
        </View>

        <View style={[styles.planCard, styles.selectedPlan]}>
          <View>
            <Text style={styles.planName}>Yearly Plan</Text>
            <Text style={styles.yearMeta}>52 weeks  •  $49.99</Text>
          </View>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$0.96/week</Text>
            <Text style={styles.trial}>3-day free trial</Text>
            <Text style={styles.saveBadge}>Save 90%</Text>
          </View>
        </View>
      </View>

      <Text style={styles.footer}>No Commitment  •  Cancel anytime</Text>
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
  footer: {
    color: '#9B9B9B',
    fontFamily: 'ClashGrotesk',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 21,
    marginTop: 0,
    textAlign: 'center',
  },
  planCard: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderRadius: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: 20,
  },
  planName: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  plans: {
    gap: 10,
    marginTop: 40,
  },
  price: {
    color: '#FFFFFF',
    fontFamily: 'ClashGrotesk',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
    textAlign: 'right',
  },
  priceCopy: {
    alignItems: 'flex-end',
    gap: 4,
  },
  quote: {
    color: '#FFFFFF',
    fontFamily: 'ClashDisplay',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    marginHorizontal: 40,
    marginTop: 30,
  },
  quoteCard: {
    backgroundColor: '#0B111E',
    borderColor: '#1970FD',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 54,
    minHeight: 156,
    padding: 10,
  },
  saveBadge: {
    alignSelf: 'flex-end',
    backgroundColor: '#1970FD',
    borderRadius: 999,
    color: '#FFFFFF',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 13,
    lineHeight: 16,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectedPlan: {
    borderColor: '#1970FD',
    borderWidth: 1,
    minHeight: 96,
  },
  trial: {
    color: '#D3D3D3',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'right',
  },
  yearMeta: {
    color: '#C7C7C7',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 8,
  },
});
