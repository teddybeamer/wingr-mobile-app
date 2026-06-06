import { Shield, TrashBinMinimalistic } from '@solar-icons/react-native/Linear';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

const privacyItems = [
  {
    body: 'Screenshots are deleted\nafter analysis.',
    icon: TrashBinMinimalistic,
    title: 'Not stored',
  },
  {
    body: "Your chats don't teach\nthe ai.",
    icon: Shield,
    title: 'Not used for training',
  },
  {
    body: 'Your data stays yours.',
    icon: TrashBinMinimalistic,
    title: 'Never sold',
  },
];

export function PrivacyScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.stack}>
        {privacyItems.map((item) => {
          const Icon = item.icon;

          return (
            <View key={item.title} style={styles.card}>
              <View style={styles.iconBox}>
                <Icon color="#DCE8FF" size={24} />
              </View>
              <View style={styles.copy}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#E3E3E3',
    fontFamily: 'ClashGrotesk',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  card: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#181818',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 22,
    minHeight: 88,
    paddingHorizontal: 16,
    width: '76%',
  },
  copy: {
    flex: 1,
    gap: 8,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: '#2557E6',
    borderRadius: 11,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  stack: {
    gap: 10,
    marginTop: 130,
  },
  title: {
    color: '#1970FD',
    fontFamily: 'ClashGrotesk',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 21,
  },
});
