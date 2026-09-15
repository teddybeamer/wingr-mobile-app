import { ArrowLeft } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { Easing, FadeInLeft } from "react-native-reanimated";
import { CTAButton } from "../components/CTAButton";
import { ProgressIndicator } from "../components/ProgressIndicator";
import type { OnboardingScreenProps } from "../types/onboarding";

const STAR_ENTRANCE = FadeInLeft.duration(350)
  .delay(100)
  .easing(Easing.out(Easing.cubic));

export function PrivacyScreen({
  canGoBack,
  content,
  currentIndex,
  onBack,
  onNext,
  onPrimaryAction,
  totalSteps,
}: OnboardingScreenProps) {
  const continueOnboarding = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (onPrimaryAction) {
      void onPrimaryAction();
      return;
    }
    onNext();
  };

  return (
    <View style={styles.screen}>
      <View>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityLabel="Go back"
            accessibilityRole="button"
            disabled={!canGoBack}
            hitSlop={8}
            onPress={onBack}
            style={!canGoBack ? styles.hiddenBackButton : undefined}
          >
            <ArrowLeft color="#D4D4D4" size={24} />
          </TouchableOpacity>
          <ProgressIndicator
            currentIndex={currentIndex}
            totalSteps={totalSteps}
          />
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.copy}>
          <Text style={styles.title}>
            <Text>Your conversations </Text>
            <Text style={styles.titleBlue}>stay private</Text>
          </Text>
          <Text style={styles.body}>{content.body}</Text>
        </View>
      </View>

      <View style={styles.middleContent}>
        <Animated.View entering={STAR_ENTRANCE}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={require("../../assets/images/star-onboarding.png")}
            style={styles.starGraphic}
          />
        </Animated.View>
      </View>

      <CTAButton label={content.ctaLabel ?? "Continue"} onPress={continueOnboarding} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 17,
  },
  copy: {
    gap: 8,
    marginTop: 16,
  },
  middleContent: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    height: 48,
  },
  headerSpacer: {
    width: 24,
  },
  hiddenBackButton: {
    opacity: 0,
  },
  screen: {
    backgroundColor: "#080808",
    flex: 1,
    paddingBottom: 22,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  starGraphic: {
    height: 242,
    width: 235,
  },
  title: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 29,
  },
  titleBlue: {
    color: "#1970FD",
  },
});
