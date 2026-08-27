import {
  InlineErrorCard,
  RepliesContent,
  VibeCheckCard,
} from "../../components/conversation/ConversationContent";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ReplyLoadingScreen } from "../../components/conversation/ReplyLoadingScreen";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

const MAX_SCREENSHOT_ANALYSIS_FAILURES = 3;

export function VibecheckScreen(props: OnboardingScreenProps) {
  const {
    analysisFailureCount = 0,
    conversation,
    onReplacementScreenshotSelected,
    onRetryScreenshotAnalysis,
  } = props;
  const canSkipResults =
    analysisFailureCount >= MAX_SCREENSHOT_ANALYSIS_FAILURES;
  const needsSpeakerConfirmation = Boolean(conversation.pendingSpeakerOcr);

  const chooseAnotherScreenshot = async () => {
    const screenshotUri = await conversation.pickScreenshot();

    if (screenshotUri) {
      await onReplacementScreenshotSelected?.(screenshotUri);
    }
  };

  if (conversation.analysisStatus === "analyzing") {
    return <ReplyLoadingScreen />;
  }

  if (needsSpeakerConfirmation) {
    return (
      <OnboardingScreenScaffold {...props}>
        <View style={styles.confirmationCard}>
          <Text style={styles.confirmationTitle}>Which side is you?</Text>
          <Text style={styles.confirmationBody}>
            This helps us read the conversation correctly.
          </Text>
          <View style={styles.confirmationActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void conversation.confirmSpeakerSide("left");
              }}
              style={styles.confirmationButton}
            >
              <Text style={styles.confirmationButtonText}>Left side</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void conversation.confirmSpeakerSide("right");
              }}
              style={styles.confirmationButton}
            >
              <Text style={styles.confirmationButtonText}>Right side</Text>
            </Pressable>
          </View>
        </View>
      </OnboardingScreenScaffold>
    );
  }

  return (
    <OnboardingScreenScaffold {...props} middleContentScrollable>
      {conversation.analysisStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            if (canSkipResults) {
              void chooseAnotherScreenshot();
              return;
            }

            void onRetryScreenshotAnalysis?.();
          }}
          onSecondaryAction={
            canSkipResults
              ? undefined
              : () => {
                  void chooseAnotherScreenshot();
                }
          }
          primaryLabel={canSkipResults ? "Choose another screenshot" : "Retry"}
          secondaryLabel={
            canSkipResults ? undefined : "Choose another screenshot"
          }
        />
      ) : null}

      {conversation.analysisStatus === "ready" && conversation.vibeCheck ? (
        <>
          <VibeCheckCard
            presentation="inlineExpandable"
            vibeCheck={conversation.vibeCheck}
          />
          <RepliesContent
            isGenerating={conversation.repliesStatus === "generating"}
            maxReplies={1}
            onRefreshReplies={conversation.refreshReplies}
            onToneChange={conversation.changeTone}
            presentation="mainFeed"
            replies={conversation.generatedReplies}
            selectedTone={conversation.selectedTone}
            showControls={false}
            showTypingIndicator
          />
        </>
      ) : null}

      {conversation.repliesStatus === "error" && conversation.error ? (
        <InlineErrorCard
          message={conversation.error.message}
          onPrimaryAction={() => {
            void conversation.generateRepliesForSelectedTone();
          }}
          primaryLabel="Retry"
        />
      ) : null}
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  confirmationActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmationBody: {
    color: "#B7B7BE",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  confirmationButton: {
    alignItems: "center",
    backgroundColor: "#1B1B1F",
    borderColor: "#3A3A40",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  confirmationButtonText: {
    color: "#F6F7FB",
    fontSize: 16,
    fontWeight: "700",
  },
  confirmationCard: {
    alignItems: "center",
    backgroundColor: "#151515",
    borderColor: "#2C2C30",
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    width: "100%",
  },
  confirmationTitle: {
    color: "#F6F7FB",
    fontSize: 22,
    fontWeight: "800",
  },
});
