import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { HomeMoreSheet } from "../components/HomeMoreSheet";
import { colors, typography } from "../theme";

// The More sheet with the paywall's Restore Purchases row, open on load. Close it
// and tap the button to open it again.
export function MoreSheetPreview() {
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
      <Pressable accessibilityRole="button" onPress={() => setVisible(true)}>
        <Text style={{ ...typography.titleSemibold16, color: colors.stone200 }}>
          Open More
        </Text>
      </Pressable>
      <HomeMoreSheet
        onAccountDeleted={async () => {}}
        onClose={() => setVisible(false)}
        onRestorePurchases={async () => {}}
        visible={visible}
      />
    </View>
  );
}
