import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewTransition, type Rect } from "./preview-transition";

const base = {
  area: { height: 760, width: 358, x: 16, y: 57 },
  cardPadding: 14,
  cardWidth: 300,
  gap: 11,
  headerHeight: 32,
  size: { height: 640, width: 296 },
};

// Where a rect lands when the card is scaled about its centre, then translated.
function applyTransform(
  rect: Rect,
  card: Rect,
  scale: number,
  translateX: number,
  translateY: number,
) {
  const cx = card.x + card.width / 2;
  const cy = card.y + card.height / 2;
  return {
    height: rect.height * scale,
    width: rect.width * scale,
    x: cx + (rect.x - cx) * scale + translateX,
    y: cy + (rect.y - cy) * scale + translateY,
  };
}

test("at the start the screenshot sits exactly on the source rect", () => {
  // Same shape as the screenshot (296 x 640), just smaller.
  const source = { height: (640 * 162) / 296, width: 162, x: 114, y: 205 };
  const t = getPreviewTransition({ ...base, source });
  const landed = applyTransform(
    t.image,
    t.card,
    t.scale,
    t.translateX,
    t.translateY,
  );

  assert.ok(Math.abs(landed.x - source.x) < 1e-9);
  assert.ok(Math.abs(landed.y - source.y) < 1e-9);
  assert.ok(Math.abs(landed.width - source.width) < 1e-9);
  assert.ok(Math.abs(landed.height - source.height) < 1e-9);
});

test("the card is centred in the available area and hugs the screenshot", () => {
  const t = getPreviewTransition({ ...base, source: null });
  assert.equal(t.card.x, 16 + (358 - 300) / 2);
  assert.equal(t.card.height, 14 * 2 + 32 + 11 + 640);
  assert.equal(t.image.y, t.card.y + 14 + 32 + 11);
  assert.equal(t.image.x, t.card.x + (300 - 296) / 2);
});

test("without a source the motion grows out of the final spot", () => {
  const t = getPreviewTransition({ ...base, source: null });
  assert.ok(Math.abs(t.scale - 0.8) < 1e-9);
  const landed = applyTransform(
    t.image,
    t.card,
    t.scale,
    t.translateX,
    t.translateY,
  );
  // Same centre as the final image, smaller.
  assert.ok(
    Math.abs(landed.x + landed.width / 2 - (t.image.x + t.image.width / 2)) <
      1e-9,
  );
  assert.ok(
    Math.abs(landed.y + landed.height / 2 - (t.image.y + t.image.height / 2)) <
      1e-9,
  );
});

test("scale never reaches zero for a degenerate source", () => {
  const t = getPreviewTransition({
    ...base,
    source: { height: 0, width: 0, x: 10, y: 10 },
  });
  assert.equal(t.scale, 0.05);
});
