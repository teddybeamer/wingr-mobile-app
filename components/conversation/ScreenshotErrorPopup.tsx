import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { ConversationFlowError } from "../../hooks/useConversationFlow";
import {
  createDeferredScreenshotPicker,
  getSemanticScreenshotError,
} from "../../lib/screenshot-analysis-error";
import { BottomSheet } from "../BottomSheet";

export function ScreenshotErrorPopup({
  error,
  onChooseAnotherScreenshot,
}: {
  error: ConversationFlowError | null;
  onChooseAnotherScreenshot: () => void | Promise<void>;
}) {
  const semanticError = getSemanticScreenshotError(error);
  const [activeError, setActiveError] = useState(semanticError);
  const [visible, setVisible] = useState(Boolean(semanticError));
  const chooseScreenshotRef = useRef(onChooseAnotherScreenshot);
  chooseScreenshotRef.current = onChooseAnotherScreenshot;
  const deferredPickerRef = useRef(
    createDeferredScreenshotPicker(() => chooseScreenshotRef.current()),
  );
  const shownErrorIdRef = useRef<number | null>(semanticError?.id ?? null);

  useEffect(() => {
    if (!semanticError || semanticError.id === shownErrorIdRef.current) return;
    shownErrorIdRef.current = semanticError.id;
    deferredPickerRef.current.cancel();
    setActiveError(semanticError);
    setVisible(true);
  }, [semanticError]);

  if (!activeError) return null;

  const dismiss = () => {
    deferredPickerRef.current.cancel();
    setVisible(false);
  };

  return (
    <BottomSheet
      onClose={dismiss}
      onClosed={() => {
        void deferredPickerRef.current.sheetClosed();
      }}
      showCloseButton
      title={activeError.presentation.title}
      visible={visible}
    >
      <View style={styles.content}>
        <Text style={styles.message}>{activeError.presentation.message}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => {
            deferredPickerRef.current.request();
            setVisible(false);
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {activeError.presentation.button}
          </Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#1970FD",
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
  },
  buttonText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 15,
    fontWeight: "600",
  },
  content: {
    gap: 18,
  },
  message: {
    color: "#D7D7D7",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
});
