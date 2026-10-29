import { Image } from "react-native";

const SAMPLES = {
  portrait: require("./assets/sample-chat.png"),
  tall: require("./assets/sample-tall.png"),
  wide: require("./assets/sample-wide.png"),
};

export type SampleName = keyof typeof SAMPLES;

// resolveAssetSource exists on native only; on web require() already gives a
// uri (or an object holding one).
export function sampleScreenshotUri(name: SampleName): string {
  const asset = SAMPLES[name] as number;
  const resolved = Image.resolveAssetSource?.(asset)?.uri;
  if (resolved) return resolved;
  const raw = asset as unknown;
  return typeof raw === "string" ? raw : ((raw as { uri?: string })?.uri ?? "");
}
