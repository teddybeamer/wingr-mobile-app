// Values come from the "Wingr" Figma variables (stone palette) plus the raw
// fills the Get Replies redesign uses without a variable.
export const colors = {
  background: "#080808",
  primaryBlue: "#1970FD",

  neutral50: "#FAFAFA",
  neutral200: "#E5E5E5",
  neutral300: "#D4D4D4",
  neutral400: "#A3A3A3",
  neutral500: "#737373",
  neutral800: "#262626",

  stone50: "#FAFAF9",
  stone100: "#F5F5F4",
  stone200: "#E7E5E4",
  stone300: "#D6D3D1",
  stone400: "#A8A29E",
  stone500: "#78716C",
  stone600: "#57534E",
  stone700: "#44403C",
  stone800: "#292524",
  stone900: "#1C1917",
  stone950: "#0C0A09",

  blue400: "#60A5FA",
  blue600: "#2563EB",
  blue900: "#1E3A8A",

  indigo50: "#EEF2FF",
  indigo100: "#E0E7FF",
  indigo200: "#C7D2FE",
  indigo600: "#4F46E5",
  indigo700: "#4338CA",
  indigo900: "#312E81",
  indigo950: "#1E1B4B",

  amber500: "#F59E0B",
  teal400: "#2DD4BF",
  teal500: "#14B8A6",

  green200: "#BBF7D0",
  green500: "#22C55E",

  red200: "#FECACA",
  red400: "#F87171",
  red500: "#EF4444",
} as const;

// Fills the design uses as raw rgba values rather than variables.
export const surfaces = {
  actionBar: "rgba(38, 38, 38, 0.5)",
  cardShadow: "rgba(0, 0, 0, 0.25)",
  iconChip: "rgba(28, 25, 23, 0.35)",
  vibeCheckBorder: "rgba(49, 46, 129, 0.3)",
  // Popup card: Figma uses #f5f5f4 as a raw fill, same value as stone100.
  dialog: "#F5F5F4",
} as const;

export type ColorToken = keyof typeof colors;
