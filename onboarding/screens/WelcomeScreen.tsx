import * as Haptics from 'expo-haptics';
import { Image, StyleSheet, Text, View } from 'react-native';
import { CTAButton } from '../components/CTAButton';
import type { OnboardingScreenProps } from '../types/onboarding';

export function WelcomeScreen({ content, onNext }: OnboardingScreenProps) {
  console.log('[Wingr boot] WelcomeScreen render', {
    hasBody: Boolean(content.body),
    hasTitle: Boolean(content.title),
  });

  const handleGetStarted = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onNext();
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topSection}>
        <Text style={styles.logo}>Wingr</Text>

        <View style={styles.copy}>
          <Text style={styles.title}>
            {content.titleParts
              ? content.titleParts.map((part, index) => (
                  <Text
                    key={`${part.text}-${index}`}
                    style={part.color === 'blue' ? styles.titleBlue : styles.titleWhite}
                  >
                    {part.text}
                  </Text>
                ))
              : content.title}
          </Text>
        </View>
      </View>

      <View style={styles.middleSection}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/welcomegraphic.png')}
          style={styles.phoneImage}
        />
      </View>

      <View style={styles.bottomSection}>
        <CTAButton
          label={content.ctaLabel ?? 'Get Started'}
          onPress={handleGetStarted}
          variant="indigo"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomSection: {
    paddingBottom: 22,
  },
  copy: {
    marginTop: 34,
  },
  logo: {
    color: '#1970FD',
    fontFamily: 'ClashDisplay',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 25,
    textAlign: 'center',
  },
  middleSection: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  phoneImage: {
    height: 397,
    width: 200,
  },
  screen: {
    backgroundColor: '#080808',
    flex: 1,
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
  titleBlue: {
    color: '#1970FD',
  },
  titleWhite: {
    color: '#FFFFFF',
  },
  topSection: {
    paddingTop: 34,
  },
});
