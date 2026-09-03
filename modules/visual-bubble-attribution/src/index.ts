export type ImageSampleRegion = {
  id: string;
  radius: number;
  x: number;
  y: number;
};

export type ImageColorSample = {
  blue: number;
  coverage: number;
  green: number;
  id: string;
  red: number;
  variance: number;
};

type SampleImageRegionsResult = {
  height: number;
  samples: ImageColorSample[];
  width: number;
};

type VisualBubbleAttributionNativeModule = {
  sampleImageRegions(
    uri: string,
    regions: ImageSampleRegion[],
  ): Promise<SampleImageRegionsResult>;
};

function getNativeModule() {
  if (typeof require !== "function") {
    return null;
  }

  try {
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: <ModuleType>(
        moduleName: string,
      ) => ModuleType | null;
    };

    return requireOptionalNativeModule<VisualBubbleAttributionNativeModule>(
      "VisualBubbleAttribution",
    );
  } catch {
    return null;
  }
}

export function sampleImageRegions(uri: string, regions: ImageSampleRegion[]) {
  const nativeModule = getNativeModule();

  return nativeModule ? nativeModule.sampleImageRegions(uri, regions) : null;
}
