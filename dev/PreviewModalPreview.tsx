import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { ScreenshotPreviewModal } from "../components/ScreenshotPreviewModal";
import { colors } from "../theme";
import { sampleScreenshotUri, type SampleName } from "./samples";

// Opens the view-only preview straight away; closing it shows a button to
// reopen.
export function PreviewModalPreview({ sample }: { sample: SampleName }) {
  const [visible, setVisible] = useState(true);

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        justifyContent: "center",
      }}
    >
      <Pressable onPress={() => setVisible(true)}>
        <Text style={{ color: colors.blue400, fontSize: 16 }}>
          Open preview
        </Text>
      </Pressable>
      <ScreenshotPreviewModal
        onClose={() => setVisible(false)}
        uri={sampleScreenshotUri(sample)}
        visible={visible}
      />
    </View>
  );
}
