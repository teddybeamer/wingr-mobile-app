import { AddSquare, Refresh } from "@solar-icons/react-native/Linear";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { OnboardingScreenProps } from "../types/onboarding";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";

export function UploadScreenShotScreen(props: OnboardingScreenProps) {
  const { conversation } = props;
  const { width: windowWidth } = useWindowDimensions();
  const screenshotUri = conversation.selectedScreenshotUri?.trim() || null;
  const cardWidth = Math.min((windowWidth - 32) * 0.74, 300);
  const cardHeight = 380;
  const uploadError =
    conversation.error?.kind === "permission"
      ? conversation.error.message
      : null;

  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.content}>
        <View
          style={[styles.uploadCard, { height: cardHeight, width: cardWidth }]}
        >
          {screenshotUri ? (
            <>
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                source={{ uri: screenshotUri }}
                style={styles.image}
              />
              <View pointerEvents="none" style={styles.changeButton}>
                <Refresh color="#FFFFFF" size={18} />
                <Text style={styles.changeText}>Change screenshot</Text>
              </View>
            </>
          ) : (
            <View pointerEvents="none" style={styles.emptyState}>
              <Text style={styles.uploadText}>Press to upload screenshot</Text>
              <AddSquare color="#E8E8E8" size={24} />
            </View>
          )}
          <Pressable
            accessibilityLabel={
              screenshotUri ? "Change screenshot" : "Upload screenshot"
            }
            accessibilityRole="button"
            onPress={() => {
              void conversation.pickScreenshot();
            }}
            style={({ pressed }) => [
              styles.tapLayer,
              pressed && styles.pressed,
            ]}
          />
        </View>
        {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  changeButton: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    bottom: 0,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    left: 0,
    paddingVertical: 14,
    position: "absolute",
    right: 0,
    zIndex: 2,
  },
  changeText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "600",
  },
  content: {
    alignItems: "center",
    gap: 10,
    width: "100%",
  },
  emptyState: {
    alignItems: "center",
    bottom: 0,
    gap: 18,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  error: {
    color: "#FF747D",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center",
  },
  image: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  pressed: {
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  tapLayer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
  },
  uploadCard: {
    backgroundColor: "#171717",
    borderColor: "#5D5D5D",
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 1,
    overflow: "hidden",
  },
  uploadText: {
    color: "#D8D8D8",
    fontFamily: "ClashGrotesk",
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },
});
