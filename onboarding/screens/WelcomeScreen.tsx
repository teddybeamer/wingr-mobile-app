import { Image, StyleSheet, Text, View } from 'react-native';
import { CTAButton } from '../components/CTAButton';
import type { OnboardingScreenProps } from '../types/onboarding';

export function WelcomeScreen({ content, onNext }: OnboardingScreenProps) {
  return (
    <View style={styles.screen}>
      <Text style={styles.logo}>Wingr</Text>

      <View style={styles.phoneWrap}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/welcomegraphic.png')}
          style={styles.phoneImage}
        />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>{content.title}</Text>
      </View>

      <View style={styles.ctaWrap}>
        <CTAButton label={content.ctaLabel ?? 'Get Started'} onPress={onNext} />
      </View>
      <Text style={styles.body}>{content.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: '#FFFFFF',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 15,
    lineHeight: 19,
    marginTop: 20,
    textAlign: 'center',
  },
  copy: {
    marginTop: 54,
  },
  ctaWrap: {
    marginTop: 22,
  },
  logo: {
    color: '#1970FD',
    fontFamily: 'ClashDisplay',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 25,
    textAlign: 'center',
  },
  phoneImage: {
    height: '100%',
    width: '100%',
  },
  phoneWrap: {
    alignSelf: 'center',
    height: 397,
    marginTop: 52,
    width: 200,
  },
  screen: {
    backgroundColor: '#080808',
    flex: 1,
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: 'ClashDisplay',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
    textAlign: 'center',
  },
});
