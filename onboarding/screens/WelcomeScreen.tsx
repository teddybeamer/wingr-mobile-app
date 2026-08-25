import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { CTAButton } from '../components/CTAButton';
import type { OnboardingScreenProps } from '../types/onboarding';

const TITLE_ENTRANCE_DURATION = 450;
const GRAPHIC_ENTRANCE_DELAY = TITLE_ENTRANCE_DURATION;
const GRAPHIC_ENTRANCE_DURATION = 500;
const CTA_ENTRANCE_DELAY = GRAPHIC_ENTRANCE_DELAY + GRAPHIC_ENTRANCE_DURATION;
const CTA_ENTRANCE_DURATION = 450;
const ENTRANCE_DISTANCE = 40;

function triggerEntranceHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function WelcomeScreen({ content, onNext }: OnboardingScreenProps) {
  const reduceMotion = useReducedMotion();
  const titleParts = content.titleParts ?? [{ text: content.title ?? '' }];
  const fullTitle = titleParts.map((part) => part.text).join('');
  const [ctaInteractive, setCtaInteractive] = useState(reduceMotion);
  const titleOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const titleTranslateX = useSharedValue(reduceMotion ? 0 : ENTRANCE_DISTANCE);
  const graphicOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const graphicTranslateX = useSharedValue(reduceMotion ? 0 : -ENTRANCE_DISTANCE);
  const ctaOpacity = useSharedValue(reduceMotion ? 1 : 0);
  const ctaTranslateX = useSharedValue(reduceMotion ? 0 : ENTRANCE_DISTANCE);

  const graphicAnimatedStyle = useAnimatedStyle(() => ({
    opacity: graphicOpacity.value,
    transform: [{ translateX: graphicTranslateX.value }],
  }));
  const ctaAnimatedStyle = useAnimatedStyle(() => ({
    opacity: ctaOpacity.value,
    transform: [{ translateX: ctaTranslateX.value }],
  }));
  const titleAnimatedStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateX: titleTranslateX.value }],
  }));

  useEffect(() => {
    const entranceEasing = Easing.out(Easing.cubic);

    if (reduceMotion) {
      titleOpacity.value = 1;
      titleTranslateX.value = 0;
      graphicOpacity.value = 1;
      graphicTranslateX.value = 0;
      ctaOpacity.value = 1;
      ctaTranslateX.value = 0;
      setCtaInteractive(true);
      return;
    }

    titleOpacity.value = 0;
    titleTranslateX.value = ENTRANCE_DISTANCE;
    graphicOpacity.value = 0;
    graphicTranslateX.value = -ENTRANCE_DISTANCE;
    ctaOpacity.value = 0;
    ctaTranslateX.value = ENTRANCE_DISTANCE;
    setCtaInteractive(false);

    titleOpacity.value = withTiming(1, {
      duration: TITLE_ENTRANCE_DURATION,
      easing: entranceEasing,
    });
    titleTranslateX.value = withTiming(0, {
      duration: TITLE_ENTRANCE_DURATION,
      easing: entranceEasing,
    });
    graphicOpacity.value = withDelay(
      GRAPHIC_ENTRANCE_DELAY,
      withTiming(1, { duration: GRAPHIC_ENTRANCE_DURATION, easing: entranceEasing }),
    );
    graphicTranslateX.value = withDelay(
      GRAPHIC_ENTRANCE_DELAY,
      withTiming(0, { duration: GRAPHIC_ENTRANCE_DURATION, easing: entranceEasing }),
    );
    ctaOpacity.value = withDelay(
      CTA_ENTRANCE_DELAY,
      withTiming(1, { duration: CTA_ENTRANCE_DURATION, easing: entranceEasing }),
    );
    ctaTranslateX.value = withDelay(
      CTA_ENTRANCE_DELAY,
      withTiming(0, { duration: CTA_ENTRANCE_DURATION, easing: entranceEasing }),
    );

    triggerEntranceHaptic();
    const graphicHapticTimer = setTimeout(
      triggerEntranceHaptic,
      GRAPHIC_ENTRANCE_DELAY,
    );
    const ctaInteractionTimer = setTimeout(() => {
      setCtaInteractive(true);
    }, CTA_ENTRANCE_DELAY + CTA_ENTRANCE_DURATION);
    const ctaHapticTimer = setTimeout(triggerEntranceHaptic, CTA_ENTRANCE_DELAY);

    return () => {
      clearTimeout(graphicHapticTimer);
      clearTimeout(ctaInteractionTimer);
      clearTimeout(ctaHapticTimer);
    };
  }, [
    ctaOpacity,
    ctaTranslateX,
    graphicOpacity,
    graphicTranslateX,
    reduceMotion,
    titleOpacity,
    titleTranslateX,
  ]);

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

        <Animated.View style={[styles.copy, titleAnimatedStyle]}>
          <Text accessibilityLabel={fullTitle} style={styles.title}>
            {titleParts.map((part, index) => (
              <Text
                key={index}
                style={part.color === 'blue' ? styles.titleBlue : styles.titleWhite}
              >
                {part.text}
              </Text>
            ))}
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.middleSection, graphicAnimatedStyle]}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/welcomegraphic.png')}
          style={styles.phoneImage}
        />
      </Animated.View>

      <Animated.View
        pointerEvents={ctaInteractive ? 'auto' : 'none'}
        style={[styles.bottomSection, ctaAnimatedStyle]}
      >
        <CTAButton
          label={content.ctaLabel ?? 'Get Started'}
          onPress={handleGetStarted}
          variant="indigo"
        />
      </Animated.View>
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
