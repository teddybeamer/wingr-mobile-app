import { GallerySend } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { Image, StyleSheet, View } from "react-native";
import { CTAButton } from "../components/CTAButton";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

export function UploadScreenShotScreen(props: OnboardingScreenProps) {
  const { conversation, onScreenshotSelected } = props;

  const chooseScreenshot = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const screenshotUri = await conversation.pickScreenshot();

    if (screenshotUri) {
      await onScreenshotSelected?.(screenshotUri);
    }
  };

  return (
    <OnboardingScreenScaffold
      {...props}
      bottomContent={
        <CTAButton
          icon={<GallerySend color="#FFFFFF" size={20} />}
          label="Choose Screenshot"
          onPress={() => {
            void chooseScreenshot();
          }}
          variant="indigo"
        />
      }
    >
      <View style={styles.middleContent}>
        <View style={styles.graphicFrame}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={require("../../assets/images/onboarding-graphic.png")}
            style={styles.graphic}
          />
        </View>
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
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
