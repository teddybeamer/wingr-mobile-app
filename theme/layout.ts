// Figma frames are 360 x 852; every redesigned screen uses a 16 px page gutter.
export const BASELINE_WIDTH = 360;

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
} as const;

export const radii = {
  sm: 12,
  md: 14,
  lg: 20,
  pill: 30,
} as const;

export const iconSizes = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
} as const;

export const layout = {
  pageGutter: spacing.xl,
  headerHeight: 60,
  cardSize: 328,
  // Choose Screenshot hero and Screenshot Chosen stage.
  stageAspectRatio: 328 / 394,
  dialogWidth: 293,
} as const;
