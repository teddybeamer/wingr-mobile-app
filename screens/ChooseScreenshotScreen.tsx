import { GalleryAdd } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { Image, StyleSheet, Text, View } from "react-native";

import { ActionButton } from "../components/ActionButton";
import { HeaderBackButton } from "../components/HeaderBackButton";
import { ScreenHeader, ScreenHeaderTitle } from "../components/ScreenHeader";
import { StageColumn } from "../components/StageColumn";
import { colors, iconSizes, radii, spacing, typography } from "../theme";

const HERO_IMAGE = require("../assets/images/redesign/choose/hero.png");

export function ChooseScreenshotScreen({
  onBack,
  onChooseScreenshot,
}: {
  onBack: () => void;
  onChooseScreenshot: () => void;
}) {
  return (
    <View style={styles.screen}>
      <ScreenHeader
        center={<ScreenHeaderTitle>Get Replies</ScreenHeaderTitle>}
        left={<HeaderBackButton onPress={onBack} />}
      />
      <StageColumn
        footer={
          <View style={styles.card}>
            <View style={styles.copy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.title}>
                Get better replies with more context
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                Include a few messages and avoid cropping your screenshot.
              </Text>
            </View>
            <ActionButton
              label="Choose Screenshot"
              leading={
                <GalleryAdd color={colors.stone50} size={iconSizes.md} />
              }
              onPress={() => {
                void Haptics.impactAsync(
                  Haptics.ImpactFeedbackStyle.Light,
                ).catch(() => {});
                onChooseScreenshot();
              }}
              variant="primary"
            />
          </View>
        }
        stage={
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={HERO_IMAGE}
            style={styles.stageImage}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stageImage: {
    height: "100%",
    left: 0,
    position: "absolute",
    top: 0,
    width: "100%",
  },
  body: { ...typography.body, color: colors.stone100 },
  card: {
    backgroundColor: colors.stone900,
    borderRadius: radii.lg,
    gap: spacing.xl,
    padding: spacing.xl,
  },
  copy: { gap: spacing.sm },
  screen: { backgroundColor: colors.background, flex: 1 },
  title: { ...typography.h2, color: colors.stone200 },
});
