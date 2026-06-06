import { Bolt, Heart, ShieldWarning, StarsMinimalistic } from '@solar-icons/react-native/Linear';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

const vibeRows = [
  {
    color: '#7C73FF',
    icon: Heart,
    label: 'Their interest',
    value: 'Medium',
  },
  {
    color: '#FFAA00',
    icon: Bolt,
    label: 'Conversation energy',
    value: 'Dry but recoverable',
  },
  {
    color: '#FF3438',
    icon: ShieldWarning,
    label: 'Risk',
    value: 'Low, but reply wisely',
  },
  {
    color: '#15C8B5',
    icon: StarsMinimalistic,
    label: 'Best move',
    value: 'Playful reply',
  },
];

export function VibecheckScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.card}>
        {vibeRows.map((row, index) => {
          const Icon = row.icon;

          return (
            <View key={row.label}>
              <View style={styles.row}>
                <View style={[styles.iconBox, { backgroundColor: `${row.color}82` }]}>
                  <Icon color="#FFFFFF" size={24} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.label}>{row.label}</Text>
                  <Text style={[styles.value, { color: row.color }]}>{row.value}</Text>
                </View>
              </View>
              {index === 0 ? (
                <View style={styles.meterTrack}>
                  <View style={styles.meterFill} />
                </View>
              ) : null}
              {index < vibeRows.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          );
        })}
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#181818',
    borderRadius: 13,
    gap: 12,
    marginHorizontal: -16,
    marginTop: 198,
    paddingBottom: 18,
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  divider: {
    backgroundColor: '#303030',
    height: 1,
    marginTop: 16,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  label: {
    color: '#D0D0D0',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 14,
    lineHeight: 18,
  },
  meterFill: {
    backgroundColor: '#7C73FF',
    borderRadius: 999,
    height: 8,
    width: '52%',
  },
  meterTrack: {
    backgroundColor: '#484848',
    borderRadius: 999,
    height: 8,
    marginTop: 14,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  rowCopy: {
    flex: 1,
  },
  value: {
    fontFamily: 'ClashGrotesk',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 23,
  },
});
