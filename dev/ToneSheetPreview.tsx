import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ToneBottomSheet } from "../components/conversation/ConversationContent";
import { colors, typography } from "../theme";
import type { ReplyTone } from "../types/wingr";

// The Choose Tone sheet, open on load. Tapping a tone selects it (the selected
// row is blue) and keeps the sheet open; close it and tap the button to reopen.
export function ToneSheetPreview() {
  const [visible, setVisible] = useState(true);
  const [tone, setTone] = useState<ReplyTone>("playful");

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        justifyContent: "center",
      }}
    >
      <Pressable accessibilityRole="button" onPress={() => setVisible(true)}>
        <Text style={{ ...typography.titleSemibold16, color: colors.stone200 }}>
          Open Choose Tone
        </Text>
      </Pressable>
      <ToneBottomSheet
        onClose={() => setVisible(false)}
        onSelect={setTone}
        selectedTone={tone}
        visible={visible}
      />
    </View>
  );
}
