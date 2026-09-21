import {
  ArrowRightUp,
  DocumentText,
  Letter,
  Lock,
  TrashBinTrash,
} from "@solar-icons/react-native/Linear";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { deleteWingrAccount } from "../lib/account-deletion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "./BottomSheet";

const PRIVACY_URL = "https://trywingr.com/privacy";
const TERMS_OF_SERVICE_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const SUPPORT_EMAIL = "try.wingr.app@gmail.com";

export function HomeMoreSheet({
  visible,
  onClose,
  onAccountDeleted,
}: {
  visible: boolean;
  onClose: () => void;
  onAccountDeleted: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const pendingDestination = useRef<
    "privacy" | "terms" | "support" | null
  >(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const openDestination = async () => {
    const destination = pendingDestination.current;
    pendingDestination.current = null;
    if (!destination) return;
    try {
      await Linking.openURL(
        destination === "privacy"
          ? PRIVACY_URL
          : destination === "terms"
            ? TERMS_OF_SERVICE_URL
            : `mailto:${SUPPORT_EMAIL}`,
      );
    } catch {
      if (destination === "privacy" || destination === "terms") {
        Alert.alert(
          destination === "privacy"
            ? "Couldn’t open privacy policy"
            : "Couldn’t open Terms of Service",
          "Please try again shortly.",
        );
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

  const confirmAccountDeletion = () => {
    if (isDeletingAccount) return;
    Alert.alert(
      "Are you sure you want to delete your account?",
      "This will permanently delete your Wingr account and associated account data.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (isDeletingAccount) return;
              setIsDeletingAccount(true);
              try {
                await deleteWingrAccount();
                onClose();
                await onAccountDeleted();
              } catch {
                Alert.alert(
                  "Couldn’t delete account",
                  "Please try again shortly.",
                );
              } finally {
                setIsDeletingAccount(false);
              }
            })();
          },
        },
      ],
    );
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
      bottomPadding={Math.max(30, insets.bottom) + 10}
    >
      <View style={styles.options}>
        {([
          { id: "privacy", label: "Privacy", Icon: Lock },
          { id: "terms", label: "Terms of Service", Icon: DocumentText },
          { id: "support", label: "Contact Support", Icon: Letter },
        ] as const).map(({ id, label, Icon }) => (
          <TouchableOpacity
            key={id}
            accessibilityRole="link"
            accessibilityLabel={label}
            accessibilityHint={
              id === "privacy"
                ? "Opens the privacy policy in your browser"
                : id === "terms"
                  ? "Opens the Terms of Service in your browser"
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
        <TouchableOpacity
          accessibilityLabel="Delete account"
          accessibilityRole="button"
          accessibilityHint="Permanently deletes your Wingr account"
          disabled={!visible || isDeletingAccount}
          activeOpacity={0.7}
          onPress={confirmAccountDeletion}
          style={[
            styles.row,
            styles.deleteRow,
            isDeletingAccount && styles.rowDisabled,
          ]}
        >
          <TrashBinTrash color="#FF5A65" size={24} />
          <Text style={[styles.label, styles.deleteLabel]}>
            {isDeletingAccount ? "Deleting account…" : "Delete account"}
          </Text>
          <ArrowRightUp color="#FF5A65" size={24} />
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  options: {
    gap: 12,
  },
  row: {
    width: "100%",
    alignItems: "center",
    borderColor: "#A3A3A3",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  label: {
    color: "#F5F5F5",
    flex: 1,
    fontFamily: "ClashGrotesk",
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 22,
  },
  deleteRow: {
    borderColor: "#FF5A65",
  },
  deleteLabel: {
    color: "#FF5A65",
  },
  rowDisabled: {
    opacity: 0.55,
  },
});
