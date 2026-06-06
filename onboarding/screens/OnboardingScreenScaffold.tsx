import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CTAButton } from '../components/CTAButton';
import { ExampleChatCard } from '../components/ExampleChatCard';
import { OnboardingHeader } from '../components/OnboardingHeader';
import { SelectionCard } from '../components/SelectionCard';
import type { OnboardingScreenProps } from '../types/onboarding';

type OnboardingScreenScaffoldProps = OnboardingScreenProps & {
  children?: ReactNode;
};

export function OnboardingScreenScaffold({
  canGoBack,
  canContinue,
  children,
  content,
  currentIndex,
  isLastStep,
  onBack,
  onComplete,
  onNext,
  onSelectChoice,
  selectedChoiceId,
  totalSteps,
}: OnboardingScreenScaffoldProps) {
  const primaryAction = isLastStep ? onComplete : onNext;

  return (
    <View style={styles.screen}>
      <OnboardingHeader
        canGoBack={canGoBack}
        currentIndex={currentIndex}
        onBack={onBack}
        totalSteps={totalSteps}
      />

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.copy}>
          <Text style={styles.title}>
            {content.titleParts
              ? content.titleParts.map((part, index) => (
                  <Text
                    key={`${part.text}-${index}`}
                    style={part.color === 'blue' ? styles.titleBlue : styles.titleWhite}
                  >
                    {part.text}
                  </Text>
                ))
              : content.title}
          </Text>
          {content.body ? <Text style={styles.body}>{content.body}</Text> : null}
        </View>

        {content.chatMessages ? <ExampleChatCard messages={content.chatMessages} /> : null}

        {content.choices ? (
          <View style={styles.choices}>
            {content.choices.map((choice, index) => (
              <SelectionCard
                description={choice.description}
                key={choice.id}
                onPress={() => onSelectChoice(choice.id)}
                selected={selectedChoiceId ? selectedChoiceId === choice.id : index === -1}
                title={choice.title}
              />
            ))}
          </View>
        ) : null}

        {children}

        {content.footerNote ? <Text style={styles.footerNote}>{content.footerNote}</Text> : null}
      </ScrollView>

      <View style={styles.actions}>
        <CTAButton
          disabled={!canContinue}
          label={content.ctaLabel ?? 'Next'}
          onPress={primaryAction}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    paddingBottom: 16,
    paddingTop: 14,
  },
  body: {
    color: '#F1F1F1',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'left',
  },
  choices: {
    gap: 16,
    marginTop: 128,
    width: '100%',
  },
  content: {
    alignItems: 'stretch',
    flexGrow: 1,
    gap: 22,
    paddingBottom: 24,
    paddingTop: 52,
  },
  copy: {
    gap: 10,
    width: '100%',
  },
  footerNote: {
    color: '#77777F',
    fontFamily: 'ClashGroteskRegular',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  screen: {
    backgroundColor: '#080808',
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: {
    color: '#F6F7FB',
    fontFamily: 'ClashDisplay',
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
    textAlign: 'left',
  },
  titleBlue: {
    color: '#1970FD',
  },
  titleWhite: {
    color: '#FFFFFF',
  },
});
