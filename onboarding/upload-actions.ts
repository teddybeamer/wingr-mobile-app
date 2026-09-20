export function createOnboardingUploadActions({
  onScreenshotSelected,
  onSkip,
  pickScreenshot,
}: {
  onScreenshotSelected?: (screenshotUri: string) => void | Promise<void>;
  onSkip: () => void;
  pickScreenshot: () => Promise<string | null>;
}) {
  return {
    async chooseScreenshot() {
      const screenshotUri = await pickScreenshot();
      if (screenshotUri) await onScreenshotSelected?.(screenshotUri);
    },
    skip() {
      onSkip();
    },
  };
}
