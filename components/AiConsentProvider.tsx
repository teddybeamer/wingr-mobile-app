import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AI_CONSENT_PARAGRAPHS,
  AI_CONSENT_TITLE,
  PRIVACY_POLICY_URL,
  aiConsent,
  type ConsentState,
} from "../lib/ai-consent";
import { CTAButton } from "../onboarding/components/CTAButton";

export type EnsureConsentResult = "granted" | "declined" | "unavailable";

type AiConsentContextValue = {
  // Saves the user's consent on the server. False when it could not be saved.
  accept(): Promise<boolean>;
  // The answer from the server (or a still valid cache of it), without asking.
  checkState(): Promise<ConsentState>;
  // Before an AI feature: resolves "granted" without asking when the user has
  // already accepted, asks (popup) when consent is missing, and "unavailable"
  // when the answer could not be determined (the user is NOT asked in that case).
  // "declined" means the user tapped "No, thanks": nothing is recorded, and the
  // next call asks again.
  ensureConsent(): Promise<EnsureConsentResult>;
  // The server refused a request for lack of consent: forget the cached answer.
  invalidate(): Promise<void>;
  // Withdraws the consent. False when it could not be withdrawn.
  withdraw(): Promise<boolean>;
};

const AiConsentContext = createContext<AiConsentContextValue | null>(null);

export function useAiConsent() {
  const value = useContext(AiConsentContext);
  if (!value) throw new Error("useAiConsent needs an AiConsentProvider.");
  return value;
}

export async function openPrivacyPolicy() {
  try {
    await Linking.openURL(PRIVACY_POLICY_URL);
  } catch {
    Alert.alert("Couldn’t open privacy policy", "Please try again shortly.");
  }
}

type DialogResult = "granted" | "declined";

// The popup is handed back only after it has finished closing (iOS reports that
// through onDismiss; the timer covers platforms that do not). The caller can then
// open the image picker straight away: iOS drops a native picker that is
// presented while this modal is still on its way out.
const DISMISS_FALLBACK_MS = 700;

// Holds the consent popup and the functions the app uses to ask for, save and
// withdraw consent. Nothing here decides access: every AI request is checked by
// the server, and this only keeps the user informed and asks at the right time.
export function AiConsentProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolverRef = useRef<((result: DialogResult) => void) | null>(null);
  const dialogRef = useRef<Promise<DialogResult> | null>(null);
  const resultRef = useRef<DialogResult | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Promise<EnsureConsentResult> | null>(null);

  const finish = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const result = resultRef.current;
    if (!result) return;
    resultRef.current = null;
    resolverRef.current?.(result);
    resolverRef.current = null;
    dialogRef.current = null;
  }, []);

  const settle = useCallback(
    (result: DialogResult) => {
      resultRef.current = result;
      setVisible(false);
      setBusy(false);
      fallbackTimerRef.current = setTimeout(finish, DISMISS_FALLBACK_MS);
    },
    [finish],
  );

  const openDialog = useCallback(() => {
    // Two requests at once share one popup.
    if (dialogRef.current) return dialogRef.current;
    const dialog = new Promise<DialogResult>((resolve) => {
      resolverRef.current = resolve;
      setFailed(false);
      setBusy(false);
      setVisible(true);
    });
    dialogRef.current = dialog;
    return dialog;
  }, []);

  const ensureConsent = useCallback(() => {
    // Two taps in a row share one question.
    if (pendingRef.current) return pendingRef.current;
    const pending = (async (): Promise<EnsureConsentResult> => {
      const state = await aiConsent.check();
      if (state === "granted") return "granted";
      if (state === "unavailable") return "unavailable";
      return openDialog();
    })().finally(() => {
      pendingRef.current = null;
    });
    pendingRef.current = pending;
    return pending;
  }, [openDialog]);

  const accept = useCallback(async () => {
    try {
      await aiConsent.accept();
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo<AiConsentContextValue>(
    () => ({
      accept,
      checkState: () => aiConsent.check(),
      ensureConsent,
      invalidate: () => aiConsent.invalidate(),
      withdraw: async () => {
        try {
          await aiConsent.withdraw();
          return true;
        } catch {
          return false;
        }
      },
    }),
    [accept, ensureConsent],
  );

  // If saving fails the popup stays open with an error, so the user can try again
  // or choose "No, thanks".
  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    if (await accept()) {
      settle("granted");
    } else {
      setBusy(false);
      setFailed(true);
    }
  };

  // "No, thanks" records nothing and closes the popup. It is shown again the next
  // time an AI feature needs consent.
  const handleDecline = () => {
    if (busy) return;
    settle("declined");
  };

  return (
    <AiConsentContext.Provider value={value}>
      {children}
      <Modal
        animationType="fade"
        onDismiss={finish}
        onRequestClose={handleDecline}
        statusBarTranslucent
        transparent
        visible={visible}
      >
        <View style={styles.backdrop}>
          <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
            <View accessibilityViewIsModal style={styles.card}>
              <ScrollView
                bounces={false}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
              >
                <Text accessibilityRole="header" style={styles.title}>
                  {AI_CONSENT_TITLE}
                </Text>
                {AI_CONSENT_PARAGRAPHS.map((paragraph) => (
                  <Text key={paragraph} style={styles.body}>
                    {paragraph}
                  </Text>
                ))}
                {failed ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    WiNGR couldn’t save your choice. Please check your
                    connection and try again.
                  </Text>
                ) : null}
              </ScrollView>
              <View style={styles.buttons}>
                <CTAButton
                  containerStyle={styles.buttonSlot}
                  disabled={busy}
                  height={56}
                  label="No, thanks"
                  onPress={handleDecline}
                  variant="secondary"
                />
                <CTAButton
                  containerStyle={styles.buttonSlot}
                  height={56}
                  label="I Accept"
                  loading={busy}
                  onPress={() => void handleAccept()}
                />
              </View>
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => void openPrivacyPolicy()}
              >
                <Text style={styles.link}>Privacy Policy</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </AiConsentContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    flex: 1,
  },
  safeArea: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: "#151515",
    borderColor: "#333337",
    borderRadius: 28,
    borderWidth: 1,
    gap: 16,
    maxHeight: "100%",
    maxWidth: 480,
    padding: 24,
    width: "100%",
  },
  content: {
    gap: 12,
  },
  title: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 29,
  },
  body: {
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
  },
  error: {
    color: "#FF5A65",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 20,
  },
  buttons: {
    flexDirection: "row",
    gap: 12,
  },
  buttonSlot: {
    flex: 1,
    width: "auto",
  },
  link: {
    alignSelf: "center",
    color: "#A3A3A3",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: "underline",
  },
});
