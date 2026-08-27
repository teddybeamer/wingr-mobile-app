import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CTAButton } from '../components/CTAButton';
import { OnboardingScreenScaffold } from './OnboardingScreenScaffold';
import type { OnboardingScreenProps } from '../types/onboarding';

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
  actions: {
    alignItems: 'center',
    gap: 12,
    height: 98,
    justifyContent: 'flex-end',
  },
  alreadyRated: {
    alignItems: 'center',
    alignSelf: 'center',
    paddingVertical: 4,
    transform: [{ translateY: -10 }],
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
    justifyContent: 'center',
  },
  messageImage: {
    height: 328,
    width: 234,
  },
});
