import { GallerySend } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { Image, StyleSheet, View } from "react-native";
import Animated, { Easing, FadeInDown } from "react-native-reanimated";
import { CTAButton } from "../components/CTAButton";
import type { OnboardingScreenProps } from "../types/onboarding";
import { createOnboardingUploadActions } from "../upload-actions";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

const GRAPHIC_ENTRANCE = FadeInDown.duration(350)
  .delay(100)
  .easing(Easing.out(Easing.cubic));

export function UploadScreenShotScreen(props: OnboardingScreenProps) {
  const { conversation, onScreenshotSelected, onSkip } = props;
  const actions = createOnboardingUploadActions({
    onScreenshotSelected,
    onSkip,
    pickScreenshot: conversation.pickScreenshot,
  });

  const chooseScreenshot = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await actions.chooseScreenshot();
  };

  return (
    <OnboardingScreenScaffold
      {...props}
      bottomContent={
        <View style={styles.actions}>
          <CTAButton
            compact
            containerStyle={styles.chooseButton}
            icon={<GallerySend color="#FFFFFF" size={20} />}
            label="Choose Screenshot"
            onPress={() => {
              void chooseScreenshot();
            }}
          />
          <CTAButton
            compact
            fullWidth={false}
            label="Skip"
            onPress={actions.skip}
            variant="secondary"
          />
        </View>
      }
    >
      <View style={styles.middleContent}>
        <Animated.View entering={GRAPHIC_ENTRANCE} style={styles.graphicFrame}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={require("../../assets/images/onboarding-graphic.png")}
            style={styles.graphic}
          />
        </Animated.View>
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  chooseButton: {
    flex: 1,
  },
  graphic: {
    aspectRatio: 924 / 909,
    height: "100%",
    width: "100%",
  },
  graphicFrame: {
    aspectRatio: 924 / 909,
    borderRadius: 20,
    overflow: "hidden",
    width: "100%",
  },
  middleContent: {
    alignItems: "center",
    width: "100%",
  },
});
