import { GalleryAdd } from "@solar-icons/react-native/Linear";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ActionButton } from "../components/ActionButton";
import { FadeInImage } from "../components/FadeInImage";
import { HeaderBackButton } from "../components/HeaderBackButton";
import { ScreenHeader, ScreenHeaderTitle } from "../components/ScreenHeader";
import { StageColumn } from "../components/StageColumn";
import { CHOOSE_HERO_IMAGE } from "../lib/choose-hero";
import { colors, iconSizes, radii, spacing, typography } from "../theme";

// The card follows the hero's fade-in: same kind of soft fade, a beat later,
// with a few points of upward drift so it settles into place.
const CARD_ENTRY_DELAY_MS = 70;
const CARD_ENTRY_DURATION_MS = 260;
const CARD_ENTRY_OFFSET = 8;

// The first screen of a flow: a hero image and a card that explains what to
// upload. Get Replies uses the defaults; Start Conversation passes its own.
export function ChooseScreenshotScreen({
  body = "Include a few messages and avoid cropping your screenshot.",
  heading = "Get better replies with more context",
  heroImage = CHOOSE_HERO_IMAGE,
  onBack,
  onChooseScreenshot,
  title = "Get Replies",
}: {
  body?: string;
  heading?: string;
  heroImage?: ImageSourcePropType;
  onBack: () => void;
  onChooseScreenshot: () => void;
  title?: string;
}) {
  const entry = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(entry, {
      delay: CARD_ENTRY_DELAY_MS,
      duration: CARD_ENTRY_DURATION_MS,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entry]);

  const cardEntryStyle = {
    opacity: entry,
    transform: [
      {
        translateY: entry.interpolate({
          inputRange: [0, 1],
          outputRange: [CARD_ENTRY_OFFSET, 0],
        }),
      },
    ],
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        center={<ScreenHeaderTitle>{title}</ScreenHeaderTitle>}
        left={<HeaderBackButton onPress={onBack} />}
      />
      <StageColumn
        footer={
          <Animated.View style={[styles.card, cardEntryStyle]}>
            <View style={styles.copy}>
              <Text maxFontSizeMultiplier={1.3} style={styles.title}>
                {heading}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                {body}
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
          </Animated.View>
        }
        stage={<FadeInImage source={heroImage} style={styles.stageImage} />}
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
