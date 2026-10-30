import { colors } from "./colors";

export type ReplyToneKey = "playful" | "casualSmallTalk" | "direct";

// Per reply tone: the emoji, the tinted chip fill, the accent (copy icon) and
// the glow behind the card, from the Get Replies Figma frame.
export const toneStyles: Record<
  ReplyToneKey,
  {
    accent: string;
    // 1 px stroke around the whole card: the tone colour at 10 %.
    cardBorder: string;
    chipBackground: string;
    // Only the Direct chip has a border in the design.
    chipBorder: string | null;
    emoji: string;
    glow: string;
    // Glow ellipse (before its -31.97 degree turn, 40 px tall): horizontal
    // radius, centre x from the card's left edge, centre height above the
    // card's bottom edge (measured on a three-line card, as drawn in Figma).
    glowCenterX: number;
    glowFromBottom: number;
    glowRx: number;
  }
> = {
  playful: {
    accent: colors.amber500,
    cardBorder: "rgba(120, 53, 15, 0.1)",
    chipBackground: "rgba(120, 53, 15, 0.5)",
    chipBorder: null,
    emoji: "🔥",
    glow: colors.amber600,
    glowCenterX: 315.1,
    glowFromBottom: 40.1,
    glowRx: 71.7,
  },
  casualSmallTalk: {
    accent: colors.teal500,
    cardBorder: "rgba(19, 78, 74, 0.1)",
    chipBackground: "rgba(19, 78, 74, 0.5)",
    chipBorder: null,
    emoji: "😊",
    glow: colors.teal600,
    glowCenterX: 326.4,
    glowFromBottom: 32.5,
    glowRx: 82.3,
  },
  direct: {
    accent: colors.blue500,
    cardBorder: "rgba(30, 58, 138, 0.1)",
    chipBackground: "rgba(30, 58, 138, 0.5)",
    chipBorder: colors.blue900,
    emoji: "🎯",
    glow: colors.blue600,
    glowCenterX: 320.4,
    glowFromBottom: 49.5,
    glowRx: 78.4,
  },
};
