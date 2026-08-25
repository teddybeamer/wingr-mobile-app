import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

const REPLY_LOADING_MESSAGES = [
  "Reading the vibe...",
  "Okay, we see it...",
  "Cooking your reply...",
] as const;

export function ReplyLoadingScreen() {
  const [messageIndex, setMessageIndex] = useState(0);
  const [messageLength, setMessageLength] = useState(0);
  const [messagePhase, setMessagePhase] = useState<
    "typing" | "holding" | "deleting"
  >("typing");
  const currentMessage = REPLY_LOADING_MESSAGES[messageIndex];
  const visibleMessage = currentMessage.slice(0, messageLength);

  useEffect(() => {
    let delay = 0;
    let nextStep: () => void;

    if (messagePhase === "typing") {
      if (messageLength < currentMessage.length) {
        delay = 32;
        nextStep = () => setMessageLength((length) => length + 1);
      } else {
        delay = 850;
        nextStep = () => setMessagePhase("holding");
      }
    } else if (messagePhase === "holding") {
      nextStep = () => setMessagePhase("deleting");
    } else if (messageLength > 0) {
      delay = 20;
      nextStep = () => setMessageLength((length) => length - 1);
    } else {
      nextStep = () => {
        setMessageIndex(
          (index) => (index + 1) % REPLY_LOADING_MESSAGES.length,
        );
        setMessagePhase("typing");
      };
    }

    const timer = setTimeout(nextStep, delay);
    return () => clearTimeout(timer);
  }, [currentMessage.length, messageIndex, messageLength, messagePhase]);

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.messageSlot}>
          <Text style={styles.message}>{visibleMessage}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    position: "relative",
    zIndex: 1,
  },
  message: {
    color: "#FAFAFA",
    fontFamily: "ClashDisplay",
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 29,
    textAlign: "center",
  },
  messageSlot: {
    alignItems: "center",
    height: 29,
    justifyContent: "center",
    width: 300,
  },
  screen: {
    backgroundColor: "#080808",
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
});
