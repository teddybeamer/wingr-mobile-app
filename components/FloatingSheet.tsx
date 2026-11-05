import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import { colors, spacing } from "../theme";
import { BottomSheet } from "./BottomSheet";

// The redesign's bottom sheet: floats 4 px from the screen edges, rounded on all
// corners with a 1 px stroke, a small handle and no drawn title (Figma "Bottom
// sheet2" / "Choose Tone"). Put the sheet's own heading and content in the
// children; `title` is only the accessibility label.
export function FloatingSheet({
  borderColor = colors.stone800,
  bottomPadding = spacing.md,
  children,
  cornerRadius = 40,
  horizontalPadding = 30,
  onClose,
  onClosed,
  title,
  visible,
}: {
  // The stroke colour, corner radius and the space below the content differ
  // between the sheets (More: stone/800, 40, 10; Choose Tone: stone/900, 30, 20).
  borderColor?: string;
  bottomPadding?: number;
  children: ReactNode;
  cornerRadius?: number;
  // Space between the sheet's stroke and its content (30 in the More sheet, 20
  // in Choose Tone).
  horizontalPadding?: number;
  onClose: () => void;
  onClosed?: () => void;
  title: string;
  visible: boolean;
}) {
  return (
    <BottomSheet
      bottomPadding={bottomPadding}
      floating
      frameStyle={[styles.frame, { borderColor, borderRadius: cornerRadius }]}
      handleStyle={styles.handle}
      hideTitle
      onClose={onClose}
      onClosed={onClosed}
      panelStyle={[styles.panel, { paddingHorizontal: horizontalPadding }]}
      title={title}
      visible={visible}
    >
      {children}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.stone950,
    borderWidth: 1,
    overflow: "hidden",
  },
  handle: {
    backgroundColor: colors.stone700,
    borderRadius: 2,
    height: 3,
    width: 80,
  },
  panel: {
    backgroundColor: "transparent",
    borderRadius: 0,
    gap: spacing.md,
    paddingTop: spacing.xxl,
  },
});
