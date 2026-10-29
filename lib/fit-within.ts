// Largest size with the given width/height ratio that fits inside a box.
// Returns null until both the box and the image ratio are known.
export function fitWithin(
  box: { height: number; width: number },
  aspectRatio: number | null,
) {
  if (
    !aspectRatio ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio <= 0 ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }

  return box.width / box.height > aspectRatio
    ? { height: box.height, width: box.height * aspectRatio }
    : { height: box.width / aspectRatio, width: box.width };
}
