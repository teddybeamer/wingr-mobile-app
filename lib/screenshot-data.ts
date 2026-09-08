export function screenshotDataUrl(base64: string) {
  // Inspect the original bytes, independent of filename or picker MIME metadata.
  const mime = base64.startsWith("iVBORw0KGgo")
    ? "image/png"
    : base64.startsWith("/9j/")
      ? "image/jpeg"
      : base64.startsWith("UklGR") &&
          atob(base64.slice(0, 16)).slice(8, 12) === "WEBP"
        ? "image/webp"
        : null;
  if (!mime) throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
  return `data:${mime};base64,${base64}`;
}
