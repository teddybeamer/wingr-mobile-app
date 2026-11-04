export function createOnboardingUploadActions({
  ensureConsent,
  onScreenshotSelected,
  onSkip,
  pickScreenshot,
}: {
  // Resolves true when the user has (or has just given) AI consent.
  ensureConsent?: () => Promise<boolean>;
  onScreenshotSelected?: (screenshotUri: string) => void | Promise<void>;
  onSkip: () => void;
  pickScreenshot: () => Promise<string | null>;
}) {
  return {
    async chooseScreenshot() {
      // Consent comes before the picker: without it no screenshot is chosen, so
      // nothing can be read or sent.
      if (ensureConsent && !(await ensureConsent())) return;
      const screenshotUri = await pickScreenshot();
      if (screenshotUri) await onScreenshotSelected?.(screenshotUri);
    },
    skip() {
      onSkip();
    },
  };
}
