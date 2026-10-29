import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { ScreenshotErrorDialog } from "../components/conversation/ScreenshotErrorDialog";
import type { ConversationFlowError } from "../hooks/useConversationFlow";
import type { UnusableScreenshotReason } from "../supabase/functions/_shared_v2/conversation";
import { colors } from "../theme";
import { ChosenPreview } from "./ChosenPreview";

// The dialog over the Screenshot Chosen screen, as it appears in the app.
// "Show again" raises a fresh error so the dialog reopens.
export function ErrorDialogPreview({
  initialPage,
  onboarding = false,
  reason,
}: {
  initialPage?: "error" | "tips";
  onboarding?: boolean;
  reason: UnusableScreenshotReason;
}) {
  const [errorId, setErrorId] = useState(1);
  const error: ConversationFlowError = {
    errorCode: "unusable_screenshot",
    failureReason: reason,
    id: errorId,
    kind: "analysis",
    message: "Unusable screenshot",
  };

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <ChosenPreview sample="portrait" />
      <Pressable
        onPress={() => setErrorId((id) => id + 1)}
        style={{ alignItems: "center", padding: 16 }}
      >
        <Text style={{ color: colors.blue400, fontSize: 16 }}>Show again</Text>
      </Pressable>
      <ScreenshotErrorDialog
        error={error}
        initialPage={initialPage}
        onChooseAnotherScreenshot={
          onboarding
            ? () => Alert.alert("Photo picker would open here")
            : undefined
        }
      />
    </View>
  );
}
