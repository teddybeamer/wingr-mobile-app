export type Rect = { height: number; width: number; x: number; y: number };

// Where the preview card and the screenshot inside it end up, and the transform
// (applied to the card, scaled about its centre, then translated) that puts the
// screenshot exactly on `source` at the start of the opening motion.
export function getPreviewTransition({
  area,
  cardPadding,
  cardWidth,
  gap,
  headerHeight,
  size,
  source,
}: {
  // Space the card is centred in, in window coordinates.
  area: Rect;
  cardPadding: number;
  cardWidth: number;
  gap: number;
  headerHeight: number;
  size: { height: number; width: number };
  // The screenshot's current place on the previous screen; when unknown the
  // motion grows out of the middle of its final spot.
  source: Rect | null;
}) {
  const cardHeight = cardPadding * 2 + headerHeight + gap + size.height;
  const card: Rect = {
    height: cardHeight,
    width: cardWidth,
    x: area.x + (area.width - cardWidth) / 2,
    y: area.y + (area.height - cardHeight) / 2,
  };
  const image: Rect = {
    height: size.height,
    width: size.width,
    x: card.x + (cardWidth - size.width) / 2,
    y: card.y + cardPadding + headerHeight + gap,
  };
  const from: Rect = source ?? {
    height: size.height * 0.8,
    width: size.width * 0.8,
    x: image.x + size.width * 0.1,
    y: image.y + size.height * 0.1,
  };

  const scale = Math.max(0.05, from.width / size.width);
  const cardCenterX = card.x + card.width / 2;
  const cardCenterY = card.y + card.height / 2;
  const imageCenterX = image.x + image.width / 2;
  const imageCenterY = image.y + image.height / 2;

  return {
    card,
    image,
    scale,
    translateX:
      from.x +
      from.width / 2 -
      cardCenterX -
      scale * (imageCenterX - cardCenterX),
    translateY:
      from.y +
      from.height / 2 -
      cardCenterY -
      scale * (imageCenterY - cardCenterY),
  };
}
