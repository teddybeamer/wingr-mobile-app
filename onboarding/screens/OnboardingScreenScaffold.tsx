import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CTAButton } from "../components/CTAButton";
import { ExampleChatCard } from "../components/ExampleChatCard";
import { OnboardingHeader } from "../components/OnboardingHeader";
import { ResponsiveMiddleContent } from "../components/ResponsiveMiddleContent";
import { SelectionCard } from "../components/SelectionCard";
import type { OnboardingScreenProps } from "../types/onboarding";

type OnboardingScreenScaffoldProps = OnboardingScreenProps & {
  children?: ReactNode;
};

export function OnboardingScreenScaffold({
  canGoBack,
  canContinue,
  children,
  content,
  ctaDisabled,
  ctaLabel,
  ctaLoading,
  currentIndex,
  isLastStep,
  onBack,
  onComplete,
  onNext,
  onPrimaryAction,
  onSelectChoice,
  selectedChoiceId,
  totalSteps,
}: OnboardingScreenScaffoldProps) {
  const primaryAction = onPrimaryAction ?? (isLastStep ? onComplete : onNext);

  return (
    <View style={styles.screen}>
      <View>
        <OnboardingHeader
          canGoBack={canGoBack}
          currentIndex={currentIndex}
          onBack={onBack}
          totalSteps={totalSteps}
        />

        <View style={styles.copy}>
          <Text style={styles.title}>
            {content.titleParts
              ? content.titleParts.map((part, index) => (
                  <Text
                    key={`${part.text}-${index}`}
                    style={
                      part.color === "blue"
                        ? styles.titleBlue
                        : styles.titleWhite
                    }
                  >
                    {part.text}
                  </Text>
                ))
              : content.title}
          </Text>
          {content.body ? (
            <Text style={styles.body}>{content.body}</Text>
          ) : null}
        </View>
      </View>

      <ResponsiveMiddleContent>
        {content.chatMessages ? (
          <ExampleChatCard messages={content.chatMessages} />
        ) : null}

        {content.choices ? (
          <View style={styles.choices}>
            {content.choices.map((choice, index) => (
              <SelectionCard
                description={choice.description}
                key={choice.id}
                onPress={() => onSelectChoice(choice.id)}
                selected={
                  selectedChoiceId
                    ? selectedChoiceId === choice.id
                    : index === -1
                }
                title={choice.title}
              />
            ))}
          </View>
        ) : null}

        {children}

        {content.footerNote ? (
          <Text style={styles.footerNote}>{content.footerNote}</Text>
        ) : null}
      </ResponsiveMiddleContent>

      <View style={styles.bottomSection}>
        <CTAButton
          disabled={ctaDisabled ?? !canContinue}
          label={ctaLabel ?? content.ctaLabel ?? "Next"}
          loading={ctaLoading}
          onPress={primaryAction}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    color: "#F1F1F1",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    lineHeight: 17,
    textAlign: "left",
  },
  bottomSection: {
    paddingBottom: 22,
  },
  choices: {
    gap: 16,
    width: "100%",
  },
  copy: {
    gap: 10,
    marginTop: 20,
    width: "100%",
  },
  footerNote: {
    color: "#77777F",
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  screen: {
    backgroundColor: "#080808",
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: {
    color: "#F6F7FB",
    fontFamily: "ClashDisplay",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 34,
    textAlign: "left",
  },
  titleBlue: {
    color: "#1970FD",
  },
  titleWhite: {
    color: "#FFFFFF",
  },
});
