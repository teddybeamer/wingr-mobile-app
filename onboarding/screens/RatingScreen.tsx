import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInLeft } from 'react-native-reanimated';
import { CTAButton } from '../components/CTAButton';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

const GRAPHIC_ENTRANCE = FadeInLeft.duration(420)
  .delay(100)
  .easing(Easing.out(Easing.cubic));

export function RatingScreen(props: OnboardingScreenProps) {
  const [ratingStarted, setRatingStarted] = useState(false);

  return (
    <OnboardingScreenScaffold
      {...props}
      bottomContent={
        <View style={styles.actions}>
          {ratingStarted ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onNext}
              style={({ pressed }) => [styles.alreadyRated, pressed && styles.alreadyRatedPressed]}
            >
              <Text style={styles.alreadyRatedText}>I already gave a rating</Text>
            </Pressable>
          ) : null}
          <CTAButton
            label="Give us a rating"
            onPress={() => setRatingStarted(true)}
          />
        </View>
      }
    >
      <Animated.View entering={GRAPHIC_ENTRANCE} style={styles.illustrationWrap}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/3d-msg.png')}
          style={styles.messageImage}
        />
      </Animated.View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    gap: 12,
    height: 98,
    justifyContent: 'flex-end',
  },
  alreadyRated: {
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
    paddingVertical: 4,
  },
  alreadyRatedPressed: {
    opacity: 0.72,
  },
  alreadyRatedText: {
    color: '#D4D4D4',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 14,
    lineHeight: 18,
    textDecorationLine: 'underline',
  },
  illustrationWrap: {
    alignItems: 'center',
    height: 328,
    justifyContent: 'center',
    width: '100%',
  },
  messageImage: {
    height: 328,
    width: 234,
  },
});
