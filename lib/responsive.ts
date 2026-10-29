// Layout is flex-first and sizes stay fixed across devices (type, button
// heights, touch targets). The only responsive input is a breakpoint for small
// iPhones, used when a layout genuinely cannot adapt through flex alone.
export const COMPACT_WIDTH_MAX = 360; // below the 360 px Figma frame (e.g. 320 pt)
export const COMPACT_HEIGHT_MAX = 700; // iPhone SE / 8 class (667 pt)

export function getBreakpoints(width: number, height: number) {
  return {
    compactHeight: height > 0 && height < COMPACT_HEIGHT_MAX,
    compactWidth: width > 0 && width < COMPACT_WIDTH_MAX,
  };
}
