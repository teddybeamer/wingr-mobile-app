import {
  BillCheck,
  Document,
  LightbulbBolt,
  Letter,
  Lock,
  ShieldCross,
  TrashBinTrash,
} from "@solar-icons/react-native/Linear";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { deleteWingrAccount } from "../lib/account-deletion";
import type { ConsentState } from "../lib/ai-consent";
import { colors, fontFamilies, iconSizes, spacing, typography } from "../theme";
import { ActionButton } from "./ActionButton";
import { useAiConsent } from "./AiConsentProvider";
import { BottomSheet } from "./BottomSheet";

const PRIVACY_URL = "https://trywingr.com/privacy";
const TERMS_OF_SERVICE_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const SUPPORT_EMAIL = "try.wingr.app@gmail.com";

export function HomeMoreSheet({
  visible,
  onClose,
  onAccountDeleted,
  onRestorePurchases,
}: {
  visible: boolean;
  onClose: () => void;
  onAccountDeleted: () => Promise<void>;
  onRestorePurchases?: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const { checkState, withdraw } = useAiConsent();
  // The row is always shown; it is dimmed while there is no consent to withdraw.
  // Consent itself is asked for when an AI feature is used.
  const [consentState, setConsentState] = useState<ConsentState | null>(null);
  const pendingDestination = useRef<"privacy" | "terms" | "support" | null>(
    null,
  );
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  const restoreInFlight = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void checkState().then((state) => {
      if (!cancelled) setConsentState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [checkState, visible]);

  const confirmWithdrawAiConsent = () => {
    if (!visible) return;
    if (consentState === "missing") {
      Alert.alert(
        "No AI consent given",
        "You haven’t allowed WiNGR to share your screenshots with its AI providers, so there’s nothing to withdraw. You’ll be asked before your next AI request.",
      );
      return;
    }
    Alert.alert(
      "Withdraw AI consent?",
      "WiNGR will stop sharing your screenshots with OpenRouter and Google Vertex AI. AI features stay off until you allow it again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (await withdraw()) {
                setConsentState("missing");
              } else {
                Alert.alert(
                  "Couldn’t withdraw consent",
                  "Please try again shortly.",
                );
              }
            })();
          },
        },
      ],
    );
  };

  const closeSheet = () => {
    if (!restoreInFlight.current) onClose();
  };

  const restorePurchases = async () => {
    if (!visible || !onRestorePurchases || restoreInFlight.current) return;

    restoreInFlight.current = true;
    setIsRestoringPurchases(true);
    try {
      await onRestorePurchases();
    } finally {
      restoreInFlight.current = false;
      setIsRestoringPurchases(false);
    }
  };

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

  // Opens after the sheet has closed (iOS cannot present over a closing Modal).
  const openLater = (destination: "privacy" | "terms" | "support") => {
    if (!visible || pendingDestination.current) return;
    pendingDestination.current = destination;
    onClose();
  };

  const confirmAccountDeletion = () => {
    if (isDeletingAccount) return;
    Alert.alert(
      "Are you sure you want to delete your account?",
      "This will permanently delete your WiNGR account and associated account data.",
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
      bottomPadding={spacing.md}
      handleStyle={styles.handle}
      hideTitle
      onClose={closeSheet}
      onClosed={() => {
        void openDestination();
      }}
      panelStyle={styles.panel}
      title="More"
      visible={visible}
    >
      <View style={styles.content}>
        <View style={styles.section}>
          <View style={styles.ideaCopy}>
            <Text style={styles.sectionTitle}>Got a great idea?</Text>
            <Text style={styles.ideaBody}>
              Missing a feature or got an idea to make WiNGR even better? We’re
              all ears!
            </Text>
          </View>
          <ActionButton
            accessibilityHint="Opens your email app"
            label="Let us know"
            leading={
              <LightbulbBolt color={colors.stone50} size={iconSizes.md} />
            }
            onPress={() => openLater("support")}
            variant="primary"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal &amp; Support</Text>
          <ActionButton
            accessibilityHint="Opens the Terms of Service in your browser"
            label="Terms of Service"
            leading={<Document color={colors.neutral400} size={iconSizes.md} />}
            onPress={() => openLater("terms")}
            variant="secondary"
          />
          <ActionButton
            accessibilityHint="Opens the privacy policy in your browser"
            label="Privacy Policy"
            leading={<Lock color={colors.neutral400} size={iconSizes.md} />}
            onPress={() => openLater("privacy")}
            variant="secondary"
          />
          <ActionButton
            accessibilityHint="Opens your email app"
            label="Contact Support"
            leading={<Letter color={colors.neutral400} size={iconSizes.md} />}
            onPress={() => openLater("support")}
            variant="secondary"
          />
          {onRestorePurchases ? (
            <ActionButton
              accessibilityHint="Restores an existing WiNGR Pro purchase"
              disabled={isRestoringPurchases}
              label={
                isRestoringPurchases
                  ? "Restoring Purchases…"
                  : "Restore Purchases"
              }
              leading={
                <BillCheck color={colors.neutral400} size={iconSizes.md} />
              }
              onPress={() => void restorePurchases()}
              variant="secondary"
            />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI &amp; Privacy</Text>
          <View style={consentState === "missing" && styles.dimmed}>
            <ActionButton
              accessibilityHint={
                consentState === "missing"
                  ? "There is no AI consent to withdraw"
                  : "Stops WiNGR from sharing your screenshots with its AI providers"
              }
              label="Withdraw AI Consent"
              leading={
                <ShieldCross color={colors.stone400} size={iconSizes.md} />
              }
              onPress={confirmWithdrawAiConsent}
              variant="secondary"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Management</Text>
          <ActionButton
            accessibilityHint="Permanently deletes your WiNGR account"
            disabled={isDeletingAccount}
            label={isDeletingAccount ? "Deleting account…" : "Delete Account"}
            leading={
              <TrashBinTrash color={colors.red400} size={iconSizes.lg} />
            }
            onPress={confirmAccountDeletion}
            variant="danger"
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    paddingVertical: spacing.xxl,
    width: "100%",
  },
  dimmed: { opacity: 0.6 },
  handle: {
    backgroundColor: colors.stone700,
    borderRadius: 2,
    height: 3,
    width: 80,
  },
  ideaBody: {
    color: colors.stone400,
    fontFamily: fontFamilies.displayMedium,
    fontSize: 14,
    letterSpacing: -0.08,
  },
  ideaCopy: { gap: 2 },
  panel: {
    backgroundColor: colors.stone950,
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    gap: spacing.md,
    paddingHorizontal: 30,
    paddingTop: spacing.xxl,
  },
  section: { gap: spacing.md, width: "100%" },
  sectionTitle: {
    ...typography.titleSemibold16,
    color: colors.stone300,
    fontSize: 18,
    lineHeight: 28,
  },
});
