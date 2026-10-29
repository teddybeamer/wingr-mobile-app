import { useState } from "react";

import { ScreenshotChosenScreen } from "../screens/ScreenshotChosenScreen";
import { sampleScreenshotUri, type SampleName } from "./samples";

export function ChosenPreview({
  animated = false,
  errorMessage = null,
  sample,
}: {
  animated?: boolean;
  errorMessage?: string | null;
  sample: SampleName | null;
}) {
  const [revealToken, setRevealToken] = useState<number | null>(
    animated ? 1 : null,
  );
  const uri = sample ? sampleScreenshotUri(sample) : null;

  return (
    <ScreenshotChosenScreen
      errorMessage={errorMessage}
      onBack={() => {}}
      onChangeScreenshot={() => {}}
      onGetReplies={() => {}}
      onRevealStarted={(token) =>
        setRevealToken((current) => (current === token ? null : current))
      }
      revealToken={revealToken}
      selectedScreenshotUri={uri}
    />
  );
}
