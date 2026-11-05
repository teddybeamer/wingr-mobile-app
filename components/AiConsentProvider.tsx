import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";

import {
  AI_CONSENT_PARAGRAPHS,
  AI_CONSENT_TITLE,
  PRIVACY_POLICY_URL,
  aiConsent,
  type ConsentState,
} from "../lib/ai-consent";
import { colors, spacing, typography } from "../theme";
import { ActionButton } from "./ActionButton";
import { DialogModal } from "./DialogModal";

export type EnsureConsentResult = "granted" | "declined" | "unavailable";

type AiConsentContextValue = {
  // Saves the user's consent on the server. False when it could not be saved.
  accept(): Promise<boolean>;
  // The answer from the server (or a still valid cache of it), without asking.
  checkState(): Promise<ConsentState>;
  // Before an AI feature: resolves "granted" without asking when the user has
  // already accepted, asks (dialog) when consent is missing, and "unavailable"
  // when the answer could not be determined (the user is NOT asked in that case).
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

// Holds the consent dialog and the functions the app uses to ask for, save and
// withdraw consent. Nothing here decides access: every AI request is checked by
// the server, and this only keeps the user informed and asks at the right time.
export function AiConsentProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolverRef = useRef<((result: EnsureConsentResult) => void) | null>(
    null,
  );
  const pendingRef = useRef<Promise<EnsureConsentResult> | null>(null);

  const settle = useCallback((result: EnsureConsentResult) => {
    setVisible(false);
    setBusy(false);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  const ensureConsent = useCallback(() => {
    // Two taps in a row share one question.
    if (pendingRef.current) return pendingRef.current;
    const pending = (async (): Promise<EnsureConsentResult> => {
      const state = await aiConsent.check();
      if (state === "granted") return "granted";
      if (state === "unavailable") return "unavailable";
      return new Promise<EnsureConsentResult>((resolve) => {
        resolverRef.current = resolve;
        setFailed(false);
        setVisible(true);
      });
    })().finally(() => {
      pendingRef.current = null;
    });
    pendingRef.current = pending;
    return pending;
  }, []);

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

  return (
    <AiConsentContext.Provider value={value}>
      {children}
      <DialogModal onClose={() => settle("declined")} visible={visible}>
        <View style={styles.content}>
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
              WiNGR couldn’t save your choice. Please try again.
            </Text>
          ) : null}
          <View style={styles.buttons}>
            <View style={styles.buttonSlot}>
              <ActionButton
                disabled={busy}
                label="No, thanks"
                onPress={() => settle("declined")}
                size="compact"
                variant="secondary"
              />
            </View>
            <View style={styles.buttonSlot}>
              <ActionButton
                disabled={busy}
                label="I Accept"
                onPress={() => void handleAccept()}
                size="compact"
                variant="primary"
              />
            </View>
          </View>
          <Text
            accessibilityRole="link"
            onPress={() => void openPrivacyPolicy()}
            style={styles.link}
          >
            Privacy Policy
          </Text>
        </View>
      </DialogModal>
    </AiConsentContext.Provider>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: "#000000" },
  buttonSlot: { flex: 1 },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  content: { gap: spacing.md, padding: spacing.md },
  error: { ...typography.body, color: colors.red500 },
  link: {
    ...typography.body,
    alignSelf: "center",
    color: colors.stone500,
    paddingVertical: spacing.xs,
    textDecorationLine: "underline",
  },
  title: { ...typography.h2, color: "#000000" },
});
