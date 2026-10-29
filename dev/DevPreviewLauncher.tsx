import { useState } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ResponsiveOverrideProvider } from "../hooks/useResponsive";
import { colors } from "../theme";
import { PREVIEWS } from "./previews";

// null = the device's real width.
const WIDTHS: (number | null)[] = [null, 320, 375, 390, 430];

// Dev-only UI preview: floating "UI" pill that opens a full-screen overlay
// over the running app. It renders production components with mock data and
// can constrain them to a given width. App.tsx only requires this file when
// __DEV__ is true, so it is not part of production bundles.
export function DevPreviewLauncher() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const preview = PREVIEWS.find((entry) => entry.id === previewId) ?? null;

  if (!open) {
    return (
      <Pressable
        accessibilityLabel="Open UI preview"
        onPress={() => setOpen(true)}
        style={[styles.pill, { bottom: Math.max(insets.bottom, 12) + 4 }]}
      >
        <Text style={styles.pillText}>UI</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.overlay, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => (preview ? setPreviewId(null) : setOpen(false))}
          style={styles.barButton}
        >
          <Text style={styles.barButtonText}>
            {preview ? "‹ List" : "Close"}
          </Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.barTitle}>
          {preview?.title ?? "UI preview"}
        </Text>
        {preview ? (
          <Pressable onPress={() => setOpen(false)} style={styles.barButton}>
            <Text style={styles.barButtonText}>Close</Text>
          </Pressable>
        ) : (
          <View style={styles.barButton} />
        )}
      </View>

      <View style={styles.widths}>
        {WIDTHS.map((value) => (
          <Pressable
            key={value ?? "device"}
            onPress={() => setWidth(value)}
            style={[styles.chip, width === value && styles.chipActive]}
          >
            <Text style={styles.chipText}>{value ?? "Device"}</Text>
          </Pressable>
        ))}
      </View>

      {preview ? (
        <ScrollView
          contentContainerStyle={styles.stageContent}
          horizontal
          style={styles.stage}
        >
          <View style={[styles.frame, width !== null && { width }]}>
            <ResponsiveOverrideProvider width={width}>
              {preview.render()}
            </ResponsiveOverrideProvider>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.list}>
          {PREVIEWS.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => setPreviewId(entry.id)}
              style={styles.listItem}
            >
              <Text style={styles.listItemText}>{entry.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  barButton: { minWidth: 56 },
  barButtonText: { color: colors.blue400, fontSize: 15 },
  barTitle: {
    color: colors.stone200,
    flex: 1,
    fontSize: 15,
    textAlign: "center",
  },
  chip: {
    backgroundColor: colors.stone800,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.primaryBlue },
  chipText: { color: colors.stone50, fontSize: 13 },
  frame: {
    alignSelf: "stretch",
    backgroundColor: colors.background,
    overflow: "hidden",
    // Device width when no override is chosen.
    width: Dimensions.get("window").width,
  },
  list: { gap: 8, padding: 16 },
  listItem: {
    backgroundColor: colors.stone900,
    borderRadius: 12,
    padding: 16,
  },
  listItemText: { color: colors.stone50, fontSize: 15 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.stone950,
    zIndex: 1000,
  },
  pill: {
    alignItems: "center",
    backgroundColor: "rgba(25, 112, 253, 0.85)",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    left: 12,
    position: "absolute",
    width: 44,
    zIndex: 1000,
  },
  pillText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  stage: { backgroundColor: colors.stone800, flex: 1 },
  stageContent: { flexGrow: 1 },
  widths: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
});
