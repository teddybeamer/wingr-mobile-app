import { ArrowRightUp, Letter, Lock } from "@solar-icons/react-native/Linear";
import * as Clipboard from "expo-clipboard";
import { useRef } from "react";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "./BottomSheet";

const PRIVACY_URL = "https://trywingr.com/privacy";
const SUPPORT_EMAIL = "try.wingr.app@gmail.com";

export function HomeMoreSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const pendingDestination = useRef<"privacy" | "support" | null>(null);

  const openDestination = async () => {
    const destination = pendingDestination.current;
    pendingDestination.current = null;
    if (!destination) return;
    try {
      await Linking.openURL(
        destination === "privacy" ? PRIVACY_URL : `mailto:${SUPPORT_EMAIL}`,
      );
    } catch {
      if (destination === "privacy") {
        Alert.alert("Couldn’t open privacy policy", "Please try again shortly.");
      } else {
        Alert.alert(
          "Couldn’t open your email app",
          `You can contact us at ${SUPPORT_EMAIL}.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Copy email",
              onPress: () => {
                void Clipboard.setStringAsync(SUPPORT_EMAIL).catch(() => {
                  Alert.alert("Couldn’t copy email", SUPPORT_EMAIL);
                });
              },
            },
          ],
        );
      }
    }
  };

  return (
    <BottomSheet
      title="More"
      titleColor="#D4D4D4"
      visible={visible}
      onClose={onClose}
      onClosed={() => {
        void openDestination();
      }}
      showHandle={false}
      bottomPadding={Math.max(30, insets.bottom) + 10}
      panelStyle={styles.panel}
    >
      {([
        { id: "privacy", label: "Privacy", Icon: Lock },
        { id: "support", label: "Contact Support", Icon: Letter },
      ] as const).map(({ id, label, Icon }) => (
        <TouchableOpacity
          key={id}
          accessibilityRole="link"
          accessibilityLabel={label}
          accessibilityHint={
            id === "privacy"
              ? "Opens the privacy policy in your browser"
              : "Opens your email app"
          }
          disabled={!visible}
          activeOpacity={0.7}
          onPress={() => {
            if (pendingDestination.current) return;
            pendingDestination.current = id;
            onClose();
          }}
          style={styles.row}
        >
          <Icon color="#A3A3A3" size={24} />
          <Text style={styles.label}>{label}</Text>
          <ArrowRightUp color="#A3A3A3" size={24} />
        </TouchableOpacity>
      ))}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 16,
    paddingHorizontal: 10,
    paddingTop: 26,
  },
  row: {
    width: "100%",
    alignItems: "center",
    borderColor: "#A3A3A3",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: {
    color: "#F5F5F5",
    flex: 1,
    fontFamily: "ClashDisplay",
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 29,
  },
});
