import type { TextStyle } from "react-native";

// Family names are the keys registered with expo-font in App.tsx.
export const fontFamilies = {
  display: "ClashDisplay",
  displayMedium: "ClashDisplayMedium",
  body: "UncutSansMedium",
} as const;

// Figma line heights are 100% ("normal"), so none is set here.
export const typography = {
  // Figma style "h1"
  h1: {
    fontFamily: fontFamilies.display,
    fontSize: 24,
    fontWeight: "600",
  },
  // Figma style "h2"
  h2: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.08,
  },
  // Figma style "Body"
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 15,
    letterSpacing: -0.08,
  },
  // Header title, button labels, reply text and metric values.
  titleSemibold16: {
    fontFamily: fontFamilies.display,
    fontSize: 16,
    fontWeight: "600",
  },
  buttonLabel14: {
    fontFamily: fontFamilies.display,
    fontSize: 14,
    fontWeight: "600",
  },
  // Loading chat: WiNGR's messages (and the typing dots) and their timestamps.
  chatMessage: {
    fontFamily: fontFamilies.display,
    fontSize: 22,
    fontWeight: "600",
  },
  timestamp: {
    fontFamily: fontFamilies.display,
    fontSize: 12,
    fontWeight: "400",
  },
  // Vibe Check summary (collapsed and expanded).
  summaryMedium16: {
    fontFamily: fontFamilies.displayMedium,
    fontSize: 16,
  },
  metricLabel: {
    fontFamily: fontFamilies.body,
    fontSize: 13,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
