import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  openPrivacyPolicy,
  useAiConsent,
} from "../../components/AiConsentProvider";
import { AI_CONSENT_PARAGRAPHS } from "../../lib/ai-consent";
import { CTAButton } from "../components/CTAButton";
import { OnboardingHeader } from "../components/OnboardingHeader";
import type { OnboardingScreenProps } from "../types/onboarding";

// Explicit consent to share screenshots with the AI providers (App Review
// Guidelines 5.1.1(i) and 5.1.2(i)). "I Accept" saves the consent on the server;
// "No, thanks" saves nothing and onboarding simply continues. The server
// refuses every AI request without a saved consent, so declining here can never
// cause a screenshot to be sent, and the user is asked again the next time they
// try an AI feature.
export function PrivacyScreen({
  canGoBack,
  content,
  currentIndex,
  onBack,
  onNext,
  onPrimaryAction,
  totalSteps,
}: OnboardingScreenProps) {
  const { accept } = useAiConsent();
  const [saving, setSaving] = useState(false);

  const continueOnboarding = () => {
    if (onPrimaryAction) {
      void onPrimaryAction();
      return;
    }
    onNext();
  };

  const handleDecline = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    continueOnboarding();
  };

  const handleAccept = async () => {
    if (saving) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    );
    setSaving(true);
    const saved = await accept();
    setSaving(false);
    if (!saved) {
      Alert.alert(
        "Couldn’t save your choice",
        "Please check your connection and try again.",
      );
      return;
    }
    continueOnboarding();
  };

  return (
    <View style={styles.screen}>
      <OnboardingHeader
        canGoBack={canGoBack}
        currentIndex={currentIndex}
        onBack={onBack}
        totalSteps={totalSteps}
      />

      <ScrollView
        contentContainerStyle={styles.copy}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {content.titleParts?.map((part, index) => (
            <Text
              key={index}
              style={part.color === "blue" ? styles.titleBlue : undefined}
            >
              {part.text}
            </Text>
          )) ?? content.title}
        </Text>
        {AI_CONSENT_PARAGRAPHS.map((paragraph) => (
          <Text key={paragraph} style={styles.body}>
            {paragraph}
          </Text>
        ))}
      </ScrollView>

      <View style={styles.actions}>
        <View style={styles.buttons}>
          <CTAButton
            containerStyle={styles.button}
            disabled={saving}
            height={56}
            label="No, thanks"
            onPress={handleDecline}
            variant="secondary"
          />
          <CTAButton
            containerStyle={styles.button}
            height={56}
            label="I Accept"
            loading={saving}
            onPress={() => void handleAccept()}
          />
        </View>
        <Text
          accessibilityRole="link"
          onPress={() => void openPrivacyPolicy()}
          style={styles.link}
        >
          Privacy Policy
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignSelf: "center",
    gap: 18,
    maxWidth: 520,
    width: "100%",
  },
  body: {
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
  },
  button: { flex: 1, width: "auto" },
  buttons: { flexDirection: "row", gap: 12 },
  copy: {
    alignSelf: "center",
    gap: 16,
    marginTop: 24,
    maxWidth: 520,
    paddingBottom: 16,
    width: "100%",
  },
  link: {
    alignSelf: "center",
    color: "#8A8A93",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    paddingVertical: 4,
    textDecorationLine: "underline",
  },
  screen: {
    backgroundColor: "#080808",
    flex: 1,
    paddingBottom: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  scroll: { flex: 1 },
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
