import { Image, StyleSheet, View } from 'react-native';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

export function RatingScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.illustrationWrap}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/3d-msg.png')}
          style={styles.messageImage}
        />
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  illustrationWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageImage: {
    height: 328,
    width: 234,
  },
});
