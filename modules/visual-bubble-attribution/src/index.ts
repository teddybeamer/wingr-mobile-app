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

export type VisualBubbleTrace = (
  stage: string,
  metadata: Record<string, unknown>,
) => void;

export type NativeImageSamplingDiagnostics = {
  image?: {
    estimatedRgbaBufferBytes?: number;
    logicalHeight?: number;
    logicalWidth?: number;
    orientation?: string;
    orientationNormalized?: boolean;
    orientationRawValue?: number;
    pixelHeight?: number;
    pixelWidth?: number;
    scale?: number;
  };
  regions?: {
    clippedBottom?: number;
    clippedLeft?: number;
    clippedRight?: number;
    clippedTop?: number;
    invalid?: number;
    lowerProbeRequested?: number;
    lowerProbeReturned?: number;
    requested?: number;
    returned?: number;
    valid?: number;
  };
  samples?: Array<{
    clippedBottom?: boolean;
    clippedLeft?: boolean;
    clippedRight?: boolean;
    clippedTop?: boolean;
    coverage?: number;
    id?: string;
    requestedNormalizedX?: number;
    requestedNormalizedY?: number;
  }>;
  timingsMs?: {
    contextDraw?: number;
    load?: number;
    regionLoop?: number;
    total?: number;
  };
};

export type SampleImageRegionsResult = {
  diagnostics?: NativeImageSamplingDiagnostics;
  height: number;
  samples: ImageColorSample[];
  width: number;
};

export type SampleImageRegionsTraceOptions = {
  inputItemCount: number;
  stage: string;
  trace?: VisualBubbleTrace;
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

const monotonicNow = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown) =>
  typeof value === "boolean" ? value : undefined;

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : undefined;

function sanitizeNativeDiagnostics(
  diagnostics: NativeImageSamplingDiagnostics | undefined,
): NativeImageSamplingDiagnostics | undefined {
  if (!diagnostics || typeof diagnostics !== "object") {
    return undefined;
  }

  const image = diagnostics.image;
  const regions = diagnostics.regions;
  const timingsMs = diagnostics.timingsMs;
  const samples = Array.isArray(diagnostics.samples)
    ? diagnostics.samples.map((sample) => ({
        clippedBottom: booleanValue(sample?.clippedBottom),
        clippedLeft: booleanValue(sample?.clippedLeft),
        clippedRight: booleanValue(sample?.clippedRight),
        clippedTop: booleanValue(sample?.clippedTop),
        coverage: finiteNumber(sample?.coverage),
        id: stringValue(sample?.id),
        requestedNormalizedX: finiteNumber(sample?.requestedNormalizedX),
        requestedNormalizedY: finiteNumber(sample?.requestedNormalizedY),
      }))
    : undefined;

  return {
    image: image
      ? {
          estimatedRgbaBufferBytes: finiteNumber(
            image.estimatedRgbaBufferBytes,
          ),
          logicalHeight: finiteNumber(image.logicalHeight),
          logicalWidth: finiteNumber(image.logicalWidth),
          orientation: stringValue(image.orientation),
          orientationNormalized: booleanValue(image.orientationNormalized),
          orientationRawValue: finiteNumber(image.orientationRawValue),
          pixelHeight: finiteNumber(image.pixelHeight),
          pixelWidth: finiteNumber(image.pixelWidth),
          scale: finiteNumber(image.scale),
        }
      : undefined,
    regions: regions
      ? {
          clippedBottom: finiteNumber(regions.clippedBottom),
          clippedLeft: finiteNumber(regions.clippedLeft),
          clippedRight: finiteNumber(regions.clippedRight),
          clippedTop: finiteNumber(regions.clippedTop),
          invalid: finiteNumber(regions.invalid),
          lowerProbeRequested: finiteNumber(regions.lowerProbeRequested),
          lowerProbeReturned: finiteNumber(regions.lowerProbeReturned),
          requested: finiteNumber(regions.requested),
          returned: finiteNumber(regions.returned),
          valid: finiteNumber(regions.valid),
        }
      : undefined,
    samples,
    timingsMs: timingsMs
      ? {
          contextDraw: finiteNumber(timingsMs.contextDraw),
          load: finiteNumber(timingsMs.load),
          regionLoop: finiteNumber(timingsMs.regionLoop),
          total: finiteNumber(timingsMs.total),
        }
      : undefined,
  };
}

function emitTrace(
  trace: VisualBubbleTrace | undefined,
  stage: string,
  metadata: Record<string, unknown>,
) {
  try {
    trace?.(stage, metadata);
  } catch {
    // Development diagnostics must never affect screenshot processing.
  }
}

const isLowerProbeId = (id: string) => id.includes(":lower:");

export async function sampleImageRegions(
  uri: string,
  regions: ImageSampleRegion[],
  traceOptions?: SampleImageRegionsTraceOptions,
) {
  const startedAt = monotonicNow();
  const nativeModule = getNativeModule();

  if (!nativeModule) {
    if (traceOptions) {
      emitTrace(traceOptions.trace, traceOptions.stage, {
        durationMs: Number((monotonicNow() - startedAt).toFixed(1)),
        inputItemCount: traceOptions.inputItemCount,
        lowerProbe: {
          requestedCount: regions.filter((region) => isLowerProbeId(region.id))
            .length,
          returnedCount: 0,
          samples: [],
        },
        outcome: "native-module-unavailable",
        requestedRegionCount: regions.length,
        returnedRegionCount: 0,
      });
    }
    return null;
  }

  try {
    const result = await nativeModule.sampleImageRegions(uri, regions);
    if (traceOptions) {
      const sanitizedNativeDiagnostics = sanitizeNativeDiagnostics(
        result.diagnostics,
      );
      const nativeSampleDiagnostics = new Map(
        sanitizedNativeDiagnostics?.samples
          ?.filter((sample) => typeof sample.id === "string")
          .map((sample) => [sample.id as string, sample]) ?? [],
      );
      const requestedLowerProbeIds = new Set(
        regions
          .filter((region) => isLowerProbeId(region.id))
          .map((region) => region.id),
      );
      const lowerSamples = result.samples
        .filter((sample) => requestedLowerProbeIds.has(sample.id))
        .map((sample) => {
          const nativeSample = nativeSampleDiagnostics.get(sample.id);
          return {
            clippedBottom: nativeSample?.clippedBottom,
            clippedLeft: nativeSample?.clippedLeft,
            clippedRight: nativeSample?.clippedRight,
            clippedTop: nativeSample?.clippedTop,
            coverage: Number(sample.coverage.toFixed(3)),
            id: sample.id,
          };
        });

      emitTrace(traceOptions.trace, traceOptions.stage, {
        durationMs: Number((monotonicNow() - startedAt).toFixed(1)),
        image: { height: result.height, width: result.width },
        inputItemCount: traceOptions.inputItemCount,
        lowerProbe: {
          requestedCount: requestedLowerProbeIds.size,
          returnedCount: lowerSamples.length,
          samples: lowerSamples,
        },
        nativeDiagnostics: sanitizedNativeDiagnostics,
        outcome: "completed",
        requestedRegionCount: regions.length,
        returnedRegionCount: result.samples.length,
      });
    }
    return result;
  } catch (error) {
    if (traceOptions) {
      emitTrace(traceOptions.trace, traceOptions.stage, {
        durationMs: Number((monotonicNow() - startedAt).toFixed(1)),
        errorType:
          error && typeof error === "object" && "name" in error
            ? String(error.name)
            : "unknown",
        inputItemCount: traceOptions.inputItemCount,
        lowerProbe: {
          requestedCount: regions.filter((region) => isLowerProbeId(region.id))
            .length,
          returnedCount: 0,
          samples: [],
        },
        outcome: "error",
        requestedRegionCount: regions.length,
        returnedRegionCount: 0,
      });
    }
    throw error;
  }
}
