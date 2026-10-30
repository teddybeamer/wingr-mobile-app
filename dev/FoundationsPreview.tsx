import { Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { useBreakpoints } from "../hooks/useResponsive";
import {
  colors,
  layout,
  radii,
  typography,
  type TypographyToken,
} from "../theme";

const SAMPLE = "Get better replies with more context";

const TYPE_SPECIMENS: { label: string; token: TypographyToken }[] = [
  { label: "h1 · Clash Display Semibold 24", token: "h1" },
  { label: "h2 · Clash Display Bold 16", token: "h2" },
  { label: "Body · Uncut Sans Medium 15", token: "body" },
  { label: "Title · Clash Display Semibold 16", token: "titleSemibold16" },
  { label: "Button · Clash Display Semibold 14", token: "buttonLabel14" },
  { label: "Chat message · Clash Display Semibold 22", token: "chatMessage" },
  { label: "Timestamp · Clash Display Regular 12", token: "timestamp" },
  { label: "Summary · Clash Display Medium 16", token: "summaryMedium16" },
  { label: "Metric label · Clash Display Medium 14", token: "metricLabel" },
];

const ASSETS = [
  {
    label: "Home · Start Conversation",
    source: require("../assets/images/redesign/home/start-conversation-card.jpg"),
  },
  {
    label: "Home · Get Replies",
    source: require("../assets/images/redesign/home/get-replies-card.jpg"),
  },
  {
    label: "Choose Screenshot hero",
    source: require("../assets/images/redesign/choose/hero.jpg"),
  },
  {
    label: "Error dialog hero",
    source: require("../assets/images/redesign/errors/hero-cant-read.png"),
  },
  {
    label: "Tip · readable",
    source: require("../assets/images/redesign/tips/tip-readable.png"),
  },
  {
    label: "Tip · latest messages",
    source: require("../assets/images/redesign/tips/tip-latest.png"),
  },
  {
    label: "Tip · visible chat",
    source: require("../assets/images/redesign/tips/tip-visible.png"),
  },
  {
    label: "Loading banner",
    source: require("../assets/images/redesign/loading/banner.png"),
  },
];

export function FoundationsPreview() {
  const { compactHeight, compactWidth, height, width } = useBreakpoints();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[typography.body, styles.muted]}>
        width {Math.round(width)} · height {Math.round(height)} · compactWidth{" "}
        {String(compactWidth)} · compactHeight {String(compactHeight)} · gutter{" "}
        {layout.pageGutter}
      </Text>

      <Text style={styles.heading}>Type</Text>
      {TYPE_SPECIMENS.map(({ label, token }) => (
        <View key={token} style={styles.specimen}>
          <Text style={styles.caption}>{label}</Text>
          <Text style={[typography[token], styles.light]}>{SAMPLE}</Text>
        </View>
      ))}

      <Text style={styles.heading}>Colors</Text>
      <View style={styles.swatches}>
        {Object.entries(colors).map(([name, value]) => (
          <View key={name} style={styles.swatch}>
            <View style={[styles.swatchChip, { backgroundColor: value }]} />
            <Text style={styles.swatchLabel}>{name}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Radii</Text>
      <View style={styles.row}>
        {Object.entries(radii).map(([name, value]) => (
          <View key={name} style={styles.radiusItem}>
            <View style={[styles.radiusBox, { borderRadius: value }]} />
            <Text style={styles.swatchLabel}>
              {name} {value}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>Assets</Text>
      {ASSETS.map(({ label, source }) => (
        <View key={label} style={styles.specimen}>
          <Text style={styles.caption}>{label}</Text>
          <Image source={source} style={styles.asset} resizeMode="contain" />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  asset: { height: 200, width: "100%" },
  caption: { color: colors.stone400, fontSize: 11 },
  content: { gap: 12, padding: layout.pageGutter, paddingBottom: 48 },
  heading: {
    ...typography.h2,
    color: colors.stone300,
    marginTop: 16,
  },
  light: { color: colors.stone50 },
  muted: { color: colors.stone400 },
  radiusBox: {
    backgroundColor: colors.stone700,
    height: 56,
    width: 56,
  },
  radiusItem: { alignItems: "center", gap: 6 },
  row: { flexDirection: "row", gap: 16 },
  specimen: { gap: 4 },
  swatch: { gap: 4, width: 72 },
  swatchChip: {
    borderColor: colors.stone700,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
  },
  swatchLabel: { color: colors.stone400, fontSize: 10 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
