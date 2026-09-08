import assert from "node:assert/strict";
import test from "node:test";
import { screenshotDataUrl } from "./screenshot-data";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
test("original screenshot bytes survive image encoding without resizing or JPEG conversion", () => {
  assert.equal(screenshotDataUrl(png), `data:image/png;base64,${png}`);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
  assert.equal(screenshotDataUrl(jpeg), `data:image/jpeg;base64,${jpeg}`);
  const webp = Buffer.from("RIFF0000WEBPVP8 ").toString("base64");
  assert.equal(screenshotDataUrl(webp), `data:image/webp;base64,${webp}`);
});
test("unsupported image bytes produce a useful terminal error", () => {
  for (const value of [
    "",
    "GIF89a",
    Buffer.from("RIFF0000WAVE").toString("base64"),
  ]) {
    assert.throws(() => screenshotDataUrl(value), /PNG, JPEG, or WebP/);
  }
});
