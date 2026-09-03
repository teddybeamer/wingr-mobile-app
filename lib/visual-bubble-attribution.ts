import type { DetectedMessage, MessageSender } from "../types/wingr";
import {
  sampleImageRegions,
  type ImageColorSample,
  type ImageSampleRegion,
} from "../modules/visual-bubble-attribution/src";

type RgbColor = { blue: number; green: number; red: number };

export type VisualBubbleEvidence = {
  avatarVariance: number;
  backgroundVariance: number;
  bubbleColor: RgbColor;
  id: string;
  leftExtent: number;
  rightExtent: number;
};

export type VisualBubbleAttributionDiagnostic = {
  cluster: number;
  id: string;
  speaker: MessageSender;
};

export type VisualBubbleAttribution = {
  confidence: number;
  continuousPairs: Array<{ firstId: string; secondId: string }>;
  diagnostics: VisualBubbleAttributionDiagnostic[];
  messages: DetectedMessage[];
};

export type VisualBubbleAttributionAttempt = {
  attribution: VisualBubbleAttribution | null;
  croppedCandidateDiagnostics?: {
    candidateId: string | null;
    candidateIndex: number | null;
    candidateIsChronologicallyLast: boolean;
    candidateEvidenceReady: boolean;
    composerOverlayDetected: boolean;
    croppedCandidate: boolean;
    edgeCoverageDetected: boolean;
    finalBounds: { normalizedBottom: number; normalizedTop: number } | null;
    lowerProbeCoverage: number[];
    lowerViewport: boolean;
    normalVisualAttributionRejected: boolean;
    obstruction: "edge-coverage" | "composer-overlay" | null;
    prototype: null | {
      candidateToMeDistance: number | null;
      candidateToThemDistance: number | null;
      confidence: number | null;
      meSourceCount: number;
      separationMargin: number | null;
      themSourceCount: number;
      uniqueMatch: boolean;
    };
  };
  croppedFallback: {
    candidateId: string;
    kind: "resolved" | "needs-confirmation";
    obstruction: "edge-coverage" | "composer-overlay";
    prototypeSpeakers: Array<{ id: string; sender: MessageSender }>;
    prototypeConfidence: number | null;
    sender: MessageSender | null;
  } | null;
  continuityDiagnostics: Array<{
    firstId: string;
    nearestBubbleDistance: number | null;
    outcome:
      | "accepted"
      | "bridge-page-like"
      | "bridge-style-mismatch"
      | "different-visual-cluster"
      | "missing-bridge-sample";
    pageDistance: number | null;
    secondId: string;
  }>;
  evidenceDiagnostics: Array<{
    id: string;
    outcome:
      | "insufficient-bubble-page-contrast"
      | "missing-region-sample"
      | "ready"
      | "style-clusters-or-layout-not-confident";
  }>;
  outcome:
    | "accepted"
    | "dimensions-unavailable"
    | "insufficient-messages"
    | "low-confidence-or-incomplete-bubble-evidence"
    | "samples-unavailable";
};

export type VisualBubbleRecoveryFragment = {
  message: DetectedMessage;
  ocrLineIndexes: number[];
  recoverable: boolean;
};

export type VisualBubbleRecoveryDiagnostics = {
  committed: boolean;
  entered: boolean;
  excludedFragmentIds: string[];
  mergePairs: Array<{ firstId: string; secondId: string }>;
  reconstructedCount: number;
  recoveredOcrLineIndexes: number[];
};

export type VisualBubbleRecoveryProposal = {
  diagnostics: VisualBubbleRecoveryDiagnostics;
  messages: DetectedMessage[];
};

export function shouldCommitVisualBubbleRecovery({
  chronologicallyLast,
  lowerViewport,
  obstruction,
  proposalChanged,
}: {
  chronologicallyLast: boolean;
  lowerViewport: boolean;
  obstruction: "edge-coverage" | "composer-overlay" | null;
  proposalChanged: boolean;
}) {
  return Boolean(
    proposalChanged && chronologicallyLast && lowerViewport && obstruction,
  );
}

export function isVisuallyContinuousBridge(
  samples: Array<{ nearestBubbleDistance: number; pageDistance: number }>,
) {
  const bubbleLikeSamples = samples.filter(
    (sample) =>
      sample.nearestBubbleDistance <= VISUAL_STYLE_DISTANCE &&
      sample.pageDistance >= VISUAL_PAGE_DISTANCE,
  ).length;

  return bubbleLikeSamples >= Math.ceil(samples.length / 2);
}

const VISUAL_PAGE_DISTANCE = 14;
const VISUAL_STYLE_DISTANCE = 48;

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const colorDistance = (first: RgbColor, second: RgbColor) => Math.hypot(first.red - second.red, first.green - second.green, first.blue - second.blue);
const asColor = (sample: ImageColorSample): RgbColor => ({ blue: sample.blue, green: sample.green, red: sample.red });

function averageColor(colors: RgbColor[]): RgbColor {
  return colors.reduce(
    (total, color) => ({ blue: total.blue + color.blue / Math.max(colors.length, 1), green: total.green + color.green / Math.max(colors.length, 1), red: total.red + color.red / Math.max(colors.length, 1) }),
    { blue: 0, green: 0, red: 0 },
  );
}

export function resolveVisualBubbleAttributionFromEvidence(messages: DetectedMessage[], evidence: VisualBubbleEvidence[]): VisualBubbleAttribution | null {
  if (messages.length < 2 || evidence.length !== messages.length) return null;
  const firstColor = evidence[0]?.bubbleColor;
  if (!firstColor) return null;
  const second = evidence.map((item) => ({ item, distance: colorDistance(item.bubbleColor, firstColor) })).sort((a, b) => b.distance - a.distance)[0];
  if (!second || second.distance < 32) return null;
  const colors = [firstColor, second.item.bubbleColor];
  const clusterIds = evidence.map((item) => colorDistance(item.bubbleColor, colors[0]) <= colorDistance(item.bubbleColor, colors[1]) ? 0 : 1);
  const clusters = [0, 1].map((clusterId) => evidence.filter((_, index) => clusterIds[index] === clusterId));
  if (clusters.some((cluster) => cluster.length === 0)) return null;
  const avatarRate = (cluster: VisualBubbleEvidence[]) => average(cluster.map((item) => item.avatarVariance > Math.max(180, item.backgroundVariance * 3) ? 1 : 0));
  const scores = clusters.map((cluster) => average(cluster.map((item) => item.rightExtent)) - avatarRate(cluster) * 0.28);
  const outgoingCluster = scores[0] >= scores[1] ? 0 : 1;
  const layoutMargin = Math.abs(scores[0] - scores[1]);
  const confidence = clamp(0.3 + clamp(colorDistance(colors[0], colors[1]) / 120) * 0.3 + clamp(layoutMargin / 0.25) * 0.25 + Math.max(avatarRate(clusters[0]), avatarRate(clusters[1])) * 0.15);
  if (confidence < 0.68 || layoutMargin < 0.07) return null;

  return {
    confidence,
    continuousPairs: [],
    diagnostics: evidence.map((item, index) => ({
      cluster: clusterIds[index],
      id: item.id,
      speaker: clusterIds[index] === outgoingCluster ? "me" : "them",
    })),
    messages: messages.map((message, index) => {
      const sender: MessageSender = clusterIds[index] === outgoingCluster ? "me" : "them";
      const membershipDistance = colorDistance(evidence[index].bubbleColor, colors[clusterIds[index]]);
      return { ...message, confidence: Math.max(message.confidence, clamp(confidence - membershipDistance / 220)), sender, speaker: sender === "me" ? "user" : "other" };
    }),
  };
}

const recoveryRegionId = (fragmentId: string, kind: string) =>
  `recovery:${fragmentId}:${kind}`;

function getRecoveryRegions(
  fragments: VisualBubbleRecoveryFragment[],
  imageWidth: number,
): ImageSampleRegion[] {
  const fragmentRegions = fragments.flatMap(({ message }) => {
    const frame = message.boundingBox;
    const centerY = frame.y + frame.height / 2;
    const horizontalPadding = Math.max(6, Math.min(14, frame.width * 0.04));
    const verticalPadding = Math.max(4, Math.min(10, frame.height * 0.08));

    return [
      { id: recoveryRegionId(message.id, "page-left"), radius: 5, x: 8, y: centerY },
      { id: recoveryRegionId(message.id, "page-right"), radius: 5, x: imageWidth - 8, y: centerY },
      { id: recoveryRegionId(message.id, "avatar"), radius: 10, x: frame.x - Math.max(42, Math.min(86, imageWidth * 0.075)), y: centerY },
      { id: recoveryRegionId(message.id, "halo-0"), radius: 5, x: frame.x - horizontalPadding, y: centerY },
      { id: recoveryRegionId(message.id, "halo-1"), radius: 5, x: frame.x + frame.width + horizontalPadding, y: centerY },
      { id: recoveryRegionId(message.id, "halo-2"), radius: 5, x: frame.x + frame.width * 0.3, y: frame.y - verticalPadding },
      { id: recoveryRegionId(message.id, "halo-3"), radius: 5, x: frame.x + frame.width * 0.7, y: frame.y + frame.height + verticalPadding },
    ];
  });

  const bridgeRegions = fragments.flatMap((first, firstIndex) =>
    fragments.slice(firstIndex + 1).flatMap((second) => {
      const firstFrame = first.message.boundingBox;
      const secondFrame = second.message.boundingBox;
      const firstBottom = firstFrame.y + firstFrame.height;
      const gap = secondFrame.y - firstBottom;
      const sharedLeft = Math.max(firstFrame.x, secondFrame.x);
      const sharedRight = Math.min(
        firstFrame.x + firstFrame.width,
        secondFrame.x + secondFrame.width,
      );
      const maximumGap = Math.max(24, firstFrame.height * 1.1, secondFrame.height * 1.1);

      if (gap <= 0 || gap > maximumGap || sharedRight - sharedLeft < 20) {
        return [];
      }

      return [0.25, 0.5, 0.75].map((position, bridgeIndex) => ({
        id: recoveryRegionId(
          `${first.message.id}:${second.message.id}`,
          `bridge-${bridgeIndex}`,
        ),
        radius: 5,
        x: sharedLeft + (sharedRight - sharedLeft) * position,
        y: firstBottom + gap / 2,
      }));
    }),
  );

  return [...fragmentRegions, ...bridgeRegions];
}

function getRecoveryEvidence(
  fragment: VisualBubbleRecoveryFragment,
  sampleMap: Map<string, ImageColorSample>,
  pageColor: RgbColor,
  imageWidth: number,
): VisualBubbleEvidence | null {
  const haloSamples = [0, 1, 2, 3]
    .map((index) => sampleMap.get(recoveryRegionId(fragment.message.id, `halo-${index}`)))
    .filter((sample): sample is ImageColorSample => Boolean(sample))
    .filter((sample) => sample.coverage >= 0.98)
    .filter((sample) => colorDistance(asColor(sample), pageColor) >= VISUAL_PAGE_DISTANCE);

  const strongestCluster = haloSamples
    .map((sample) => ({
      members: haloSamples.filter(
        (candidate) => colorDistance(asColor(candidate), asColor(sample)) <= VISUAL_STYLE_DISTANCE,
      ),
      sample,
    }))
    .sort((first, second) => second.members.length - first.members.length)[0];

  if (!strongestCluster || strongestCluster.members.length < 2) {
    return null;
  }

  const avatar = sampleMap.get(recoveryRegionId(fragment.message.id, "avatar"));
  const pageVariances = [
    sampleMap.get(recoveryRegionId(fragment.message.id, "page-left"))?.variance,
    sampleMap.get(recoveryRegionId(fragment.message.id, "page-right"))?.variance,
  ].filter((value): value is number => typeof value === "number");

  return {
    avatarVariance: avatar?.variance ?? 0,
    backgroundVariance: average(pageVariances),
    bubbleColor: averageColor(strongestCluster.members.map(asColor)),
    id: fragment.message.id,
    leftExtent: fragment.message.boundingBox.x / imageWidth,
    rightExtent:
      (fragment.message.boundingBox.x + fragment.message.boundingBox.width) /
      imageWidth,
  };
}

function recoveryBridgeSamples(
  firstId: string,
  secondId: string,
  sampleMap: Map<string, ImageColorSample>,
) {
  return [0, 1, 2]
    .map((index) =>
      sampleMap.get(
        recoveryRegionId(`${firstId}:${secondId}`, `bridge-${index}`),
      ),
    )
    .filter((sample): sample is ImageColorSample => Boolean(sample))
    .filter((sample) => sample.coverage >= 0.98);
}

function recoveryFramesCanJoin(
  first: DetectedMessage,
  second: DetectedMessage,
  imageWidth: number,
) {
  const firstRight = first.boundingBox.x + first.boundingBox.width;
  const secondRight = second.boundingBox.x + second.boundingBox.width;
  const overlap =
    Math.min(firstRight, secondRight) -
    Math.max(first.boundingBox.x, second.boundingBox.x);
  const overlapRatio =
    Math.max(overlap, 0) /
    Math.max(Math.min(first.boundingBox.width, second.boundingBox.width), 1);
  const edgeTolerance = Math.max(8, imageWidth * 0.07);
  const aligned =
    Math.min(
      Math.abs(first.boundingBox.x - second.boundingBox.x),
      Math.abs(firstRight - secondRight),
    ) <= edgeTolerance;

  return aligned || overlapRatio >= 0.45;
}

function mergeLanguageEvidence(
  first: DetectedMessage["languageEvidence"],
  second: DetectedMessage["languageEvidence"],
) {
  const counts = new Map<string, number>();
  for (const evidence of [...(first ?? []), ...(second ?? [])]) {
    counts.set(evidence.tag, (counts.get(evidence.tag) ?? 0) + evidence.lineCount);
  }
  const merged = [...counts.entries()].map(([tag, lineCount]) => ({ tag, lineCount }));
  return merged.length > 0 ? merged : undefined;
}

function mergeRecoveryMessage(first: DetectedMessage, second: DetectedMessage) {
  const right = Math.max(
    first.boundingBox.x + first.boundingBox.width,
    second.boundingBox.x + second.boundingBox.width,
  );
  const bottom = Math.max(
    first.boundingBox.y + first.boundingBox.height,
    second.boundingBox.y + second.boundingBox.height,
  );
  const left = Math.min(first.boundingBox.x, second.boundingBox.x);
  const top = Math.min(first.boundingBox.y, second.boundingBox.y);

  return {
    ...first,
    boundingBox: { height: bottom - top, width: right - left, x: left, y: top },
    confidence: Math.min(first.confidence, second.confidence),
    languageEvidence: mergeLanguageEvidence(first.languageEvidence, second.languageEvidence),
    sender: "unknown" as const,
    speaker: "unknown" as const,
    text: `${first.text} ${second.text}`.replace(/\s+/g, " ").trim(),
  };
}

export function reconstructVisualBubblesFromSamples({
  fragments,
  imageWidth,
  samples,
}: {
  fragments: VisualBubbleRecoveryFragment[];
  imageWidth: number;
  samples: ImageColorSample[];
}): VisualBubbleRecoveryProposal {
  const ordered = [...fragments].sort(
    (first, second) =>
      first.message.boundingBox.y - second.message.boundingBox.y,
  );
  const sampleMap = new Map(samples.map((sample) => [sample.id, sample]));
  const pageSamples = ordered.flatMap(({ message }) =>
    ["page-left", "page-right"]
      .map((kind) => sampleMap.get(recoveryRegionId(message.id, kind)))
      .filter((sample): sample is ImageColorSample => Boolean(sample)),
  );
  const pageColor = averageColor(pageSamples.map(asColor));
  const evidenceById = new Map(
    ordered.map((fragment) => [
      fragment.message.id,
      getRecoveryEvidence(fragment, sampleMap, pageColor, imageWidth),
    ]),
  );
  const excludedFragmentIds: string[] = [];
  const mergePairs: Array<{ firstId: string; secondId: string }> = [];
  const recoveredOcrLineIndexes: number[] = [];
  const reconstructed: Array<{
    evidence: VisualBubbleEvidence;
    message: DetectedMessage;
    tailId: string;
  }> = [];

  for (const fragment of ordered) {
    const evidence = evidenceById.get(fragment.message.id) ?? null;
    const previous = reconstructed[reconstructed.length - 1];
    const previousFragmentEvidence = previous
      ? evidenceById.get(previous.tailId) ?? previous.evidence
      : null;
    const bridgeSamples = previous
      ? recoveryBridgeSamples(previous.tailId, fragment.message.id, sampleMap)
      : [];
    const bridgeDistances =
      previous && previousFragmentEvidence
        ? bridgeSamples.map((sample) => ({
            nearestBubbleDistance: Math.min(
              colorDistance(asColor(sample), previousFragmentEvidence.bubbleColor),
              evidence
                ? colorDistance(asColor(sample), evidence.bubbleColor)
                : Number.POSITIVE_INFINITY,
            ),
            pageDistance: colorDistance(asColor(sample), pageColor),
          }))
        : [];
    const visualStyleMatches = Boolean(
      previousFragmentEvidence &&
        (!evidence ||
          colorDistance(previousFragmentEvidence.bubbleColor, evidence.bubbleColor) <=
            VISUAL_STYLE_DISTANCE),
    );
    const canMerge = Boolean(
      previous &&
        previousFragmentEvidence &&
        recoveryFramesCanJoin(previous.message, fragment.message, imageWidth) &&
        bridgeDistances.length === 3 &&
        visualStyleMatches &&
        isVisuallyContinuousBridge(bridgeDistances),
    );

    if (canMerge && (evidence || fragment.recoverable)) {
      previous.message = mergeRecoveryMessage(previous.message, fragment.message);
      previous.tailId = fragment.message.id;
      if (evidence) {
        previous.evidence = {
          ...previous.evidence,
          bubbleColor: averageColor([
            previous.evidence.bubbleColor,
            evidence.bubbleColor,
          ]),
          rightExtent: Math.max(previous.evidence.rightExtent, evidence.rightExtent),
          leftExtent: Math.min(previous.evidence.leftExtent, evidence.leftExtent),
        };
      }
      mergePairs.push({ firstId: previous.message.id, secondId: fragment.message.id });
      if (fragment.recoverable) {
        recoveredOcrLineIndexes.push(...fragment.ocrLineIndexes);
      }
      continue;
    }

    if (!evidence || fragment.recoverable) {
      excludedFragmentIds.push(fragment.message.id);
      continue;
    }

    reconstructed.push({ evidence, message: fragment.message, tailId: fragment.message.id });
  }

  return {
    diagnostics: {
      committed: false,
      entered: true,
      excludedFragmentIds,
      mergePairs,
      reconstructedCount: reconstructed.length,
      recoveredOcrLineIndexes,
    },
    messages: reconstructed.map(({ message }) => message),
  };
}

export async function inspectVisualBubbleRecovery({
  fragments,
  screenshotUri,
}: {
  fragments: VisualBubbleRecoveryFragment[];
  screenshotUri: string;
}): Promise<VisualBubbleRecoveryProposal | null> {
  if (fragments.length < 2) return null;
  const dimensions = await sampleImageRegions(screenshotUri, [
    { id: "recovery:dimensions", radius: 1, x: 0, y: 0 },
  ]);
  if (!dimensions || dimensions.width < 40 || dimensions.height < 40) return null;
  const sampled = await sampleImageRegions(
    screenshotUri,
    getRecoveryRegions(fragments, dimensions.width),
  );
  if (!sampled) return null;

  return reconstructVisualBubblesFromSamples({
    fragments,
    imageWidth: sampled.width,
    samples: sampled.samples,
  });
}

function getRegions(messages: DetectedMessage[], imageWidth: number, imageHeight: number): ImageSampleRegion[] {
  const messageRegions = messages.flatMap((message) => {
    const frame = message.boundingBox; const y = frame.y + frame.height / 2;
    const inset = Math.max(12, Math.min(28, frame.width * 0.12)); const avatarOffset = Math.max(42, Math.min(86, imageWidth * 0.075));
    return [
      { id: `${message.id}:left`, radius: 7, x: frame.x - inset, y },
      { id: `${message.id}:right`, radius: 7, x: frame.x + frame.width + inset, y },
      { id: `${message.id}:page-left`, radius: 7, x: 8, y },
      { id: `${message.id}:page-right`, radius: 7, x: imageWidth - 8, y },
      { id: `${message.id}:avatar`, radius: 12, x: frame.x - avatarOffset, y },
    ];
  });

  const bridgeRegions = messages.slice(0, -1).flatMap((first, index) => {
    const second = messages[index + 1];
    const firstBottom = first.boundingBox.y + first.boundingBox.height;
    const gap = second.boundingBox.y - firstBottom;
    const sharedLeft = Math.max(first.boundingBox.x, second.boundingBox.x);
    const sharedRight = Math.min(
      first.boundingBox.x + first.boundingBox.width,
      second.boundingBox.x + second.boundingBox.width,
    );

    if (gap <= 0 || sharedRight - sharedLeft < 20) return [];

    const sharedWidth = sharedRight - sharedLeft;

    return [0.25, 0.5, 0.75].map((position, bridgeIndex) => ({
      id: `bridge:${first.id}:${second.id}:${bridgeIndex}`,
      radius: 7,
      x: sharedLeft + sharedWidth * position,
      y: firstBottom + gap / 2,
    }));
  });

  const finalMessage = messages[messages.length - 1];
  const lowerEdgeRegions = finalMessage
    ? [0.22, 0.5, 0.78].map((position, index) => ({
        id: `${finalMessage.id}:lower:${index}`,
        radius: 8,
        x: finalMessage.boundingBox.x + finalMessage.boundingBox.width * position,
        y: Math.min(
          imageHeight + 16,
          finalMessage.boundingBox.y + finalMessage.boundingBox.height + 28,
        ),
      }))
    : [];

  return [...messageRegions, ...bridgeRegions, ...lowerEdgeRegions];
}

function deriveEvidence(messages: DetectedMessage[], samples: ImageColorSample[], imageWidth: number) {
  const sampleMap = new Map(samples.map((sample) => [sample.id, sample]));
  const pageSamples = messages.flatMap((message) => [sampleMap.get(`${message.id}:page-left`), sampleMap.get(`${message.id}:page-right`)].filter((sample): sample is ImageColorSample => Boolean(sample)));
  const pageColor = averageColor(pageSamples.map(asColor));
  const evidenceDiagnostics: VisualBubbleAttributionAttempt["evidenceDiagnostics"] = [];
  const evidence = messages.map((message) => {
    const left = sampleMap.get(`${message.id}:left`); const right = sampleMap.get(`${message.id}:right`); const avatar = sampleMap.get(`${message.id}:avatar`);
    const pageVariances = [sampleMap.get(`${message.id}:page-left`)?.variance, sampleMap.get(`${message.id}:page-right`)?.variance].filter((value): value is number => typeof value === "number");
    if (!left || !right || !avatar) {
      evidenceDiagnostics.push({ id: message.id, outcome: "missing-region-sample" });
      return null;
    }
    const bubble = [left, right].sort((a, b) => colorDistance(asColor(b), pageColor) - colorDistance(asColor(a), pageColor))[0];
    if (!bubble || colorDistance(asColor(bubble), pageColor) < VISUAL_PAGE_DISTANCE) {
      evidenceDiagnostics.push({ id: message.id, outcome: "insufficient-bubble-page-contrast" });
      return null;
    }
    evidenceDiagnostics.push({ id: message.id, outcome: "ready" });
    return { avatarVariance: avatar.variance, backgroundVariance: average(pageVariances), bubbleColor: asColor(bubble), id: message.id, leftExtent: message.boundingBox.x / imageWidth, rightExtent: (message.boundingBox.x + message.boundingBox.width) / imageWidth };
  });
  return {
    evidence: evidence.some((item) => item === null)
      ? null
      : evidence as VisualBubbleEvidence[],
    evidenceDiagnostics,
    partialEvidence: evidence,
    pageColor,
    sampleMap,
  };
}

const CROPPED_PROTOTYPE_MAX_DISTANCE = 32;
const CROPPED_PROTOTYPE_MIN_MARGIN = 16;

function messageForEvidence(evidence: VisualBubbleEvidence): DetectedMessage {
  return {
    boundingBox: { height: 1, width: 1, x: evidence.leftExtent * 1000, y: 0 },
    confidence: 0.4,
    id: evidence.id,
    sender: "unknown",
    speaker: "unknown",
    text: evidence.id,
    xPosition: "center",
  };
}

function getPrototypeColors(
  evidence: VisualBubbleEvidence[],
  attribution: VisualBubbleAttribution,
) {
  const speakerById = new Map(
    attribution.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic.speaker]),
  );
  const grouped = new Map<MessageSender, RgbColor[]>();

  for (const item of evidence) {
    const sender = speakerById.get(item.id);
    if (!sender) {
      continue;
    }
    grouped.set(sender, [...(grouped.get(sender) ?? []), item.bubbleColor]);
  }

  const me = grouped.get("me");
  const them = grouped.get("them");
  return me && them ? { me: averageColor(me), them: averageColor(them) } : null;
}

export function resolveCroppedBottomBubbleFromEvidence({
  candidate,
  candidateId,
  obstruction,
  priorEvidence,
}: {
  candidate: VisualBubbleEvidence;
  candidateId: string;
  obstruction: "edge-coverage" | "composer-overlay";
  priorEvidence: VisualBubbleEvidence[];
}): NonNullable<VisualBubbleAttributionAttempt["croppedFallback"]> {
  const prototypeAttribution = resolveVisualBubbleAttributionFromEvidence(
    priorEvidence.map(messageForEvidence),
    priorEvidence,
  );
  const prototypes = prototypeAttribution
    ? getPrototypeColors(priorEvidence, prototypeAttribution)
    : null;

  if (!prototypeAttribution || !prototypes) {
    return {
      candidateId,
      kind: "needs-confirmation",
      obstruction,
      prototypeSpeakers: [],
      prototypeConfidence: null,
      sender: null,
    };
  }

  const meDistance = colorDistance(candidate.bubbleColor, prototypes.me);
  const themDistance = colorDistance(candidate.bubbleColor, prototypes.them);
  const sender: MessageSender = meDistance <= themDistance ? "me" : "them";
  const bestDistance = Math.min(meDistance, themDistance);
  const otherDistance = Math.max(meDistance, themDistance);
  const prototypeConfidence = clamp(
    prototypeAttribution.confidence - bestDistance / 220,
  );
  const uniqueMatch =
    bestDistance <= CROPPED_PROTOTYPE_MAX_DISTANCE &&
    otherDistance - bestDistance >= CROPPED_PROTOTYPE_MIN_MARGIN &&
    prototypeConfidence >= 0.68;

  return {
    candidateId,
    kind: uniqueMatch ? "resolved" : "needs-confirmation",
    obstruction,
    prototypeSpeakers: prototypeAttribution.diagnostics.map((diagnostic) => ({
      id: diagnostic.id,
      sender: diagnostic.speaker,
    })),
    prototypeConfidence: Number(prototypeConfidence.toFixed(3)),
    sender: uniqueMatch ? sender : null,
  };
}

export function getCroppedBottomObstruction({
  candidate,
  lowerSamples,
  normalVisualAttributionRejected,
  pageColor,
}: {
  candidate: VisualBubbleEvidence | null;
  lowerSamples: ImageColorSample[];
  normalVisualAttributionRejected: boolean;
  pageColor: RgbColor;
}): "edge-coverage" | "composer-overlay" | null {
  if (
    !normalVisualAttributionRejected ||
    !candidate ||
    lowerSamples.length !== 3 ||
    candidate.rightExtent <= 0 ||
    candidate.leftExtent < 0
  ) {
    return null;
  }

  const lowerColor = averageColor(lowerSamples.map(asColor));
  const edgeCoverage = lowerSamples.some((sample) => sample.coverage < 0.98);
  const composerOverlay =
    lowerSamples.every(
      (sample) => colorDistance(asColor(sample), lowerColor) <= 12,
    ) &&
    colorDistance(lowerColor, candidate.bubbleColor) >= 24 &&
    colorDistance(lowerColor, pageColor) >= 14;

  return edgeCoverage ? "edge-coverage" : composerOverlay ? "composer-overlay" : null;
}

function getCroppedBottomFallback({
  height,
  messages,
  pageColor,
  partialEvidence,
  sampleMap,
}: {
  height: number;
  messages: DetectedMessage[];
  pageColor: RgbColor;
  partialEvidence: Array<VisualBubbleEvidence | null>;
  sampleMap: Map<string, ImageColorSample>;
}): VisualBubbleAttributionAttempt["croppedFallback"] {
  const candidateIndex = messages.length - 1;
  const candidateMessage = messages[candidateIndex];
  const candidate = partialEvidence[candidateIndex];
  const lowerSamples = [0, 1, 2]
    .map((index) => sampleMap.get(`${candidateMessage?.id}:lower:${index}`))
    .filter((sample): sample is ImageColorSample => Boolean(sample));

  if (
    !candidateMessage ||
    !candidate ||
    lowerSamples.length !== 3 ||
    candidateMessage.boundingBox.y + candidateMessage.boundingBox.height < height * 0.78
  ) {
    return null;
  }

  const obstruction = getCroppedBottomObstruction({
    candidate,
    lowerSamples,
    normalVisualAttributionRejected: true,
    pageColor,
  });

  if (!obstruction) {
    return null;
  }

  return resolveCroppedBottomBubbleFromEvidence({
    candidate,
    candidateId: candidateMessage.id,
    obstruction,
    priorEvidence: partialEvidence.slice(0, candidateIndex).filter(
      (item): item is VisualBubbleEvidence => Boolean(item),
    ),
  });
}

function getCroppedCandidateDiagnostics({
  attribution,
  height,
  messages,
  pageColor,
  partialEvidence,
  sampleMap,
}: {
  attribution: VisualBubbleAttribution | null;
  height: number;
  messages: DetectedMessage[];
  pageColor: RgbColor;
  partialEvidence: Array<VisualBubbleEvidence | null>;
  sampleMap: Map<string, ImageColorSample>;
}): NonNullable<VisualBubbleAttributionAttempt["croppedCandidateDiagnostics"]> {
  const candidateIndex = messages.length - 1;
  const candidateMessage = messages[candidateIndex] ?? null;
  const candidate = candidateMessage ? partialEvidence[candidateIndex] : null;
  const lowerSamples = candidateMessage
    ? [0, 1, 2]
        .map((index) => sampleMap.get(`${candidateMessage.id}:lower:${index}`))
        .filter((sample): sample is ImageColorSample => Boolean(sample))
    : [];
  const normalVisualAttributionRejected = !attribution;
  const lowerViewport = Boolean(
    candidateMessage && candidateMessage.boundingBox.y + candidateMessage.boundingBox.height >= height * 0.78,
  );
  const lowerColor = averageColor(lowerSamples.map(asColor));
  const edgeCoverageDetected = lowerSamples.some((sample) => sample.coverage < 0.98);
  const composerOverlayDetected = Boolean(
    candidate &&
      lowerSamples.length === 3 &&
      lowerSamples.every((sample) => colorDistance(asColor(sample), lowerColor) <= 12) &&
      colorDistance(lowerColor, candidate.bubbleColor) >= 24 &&
      colorDistance(lowerColor, pageColor) >= 14,
  );
  const obstruction = getCroppedBottomObstruction({
    candidate,
    lowerSamples,
    normalVisualAttributionRejected,
    pageColor,
  });
  const croppedCandidate = Boolean(
    candidateMessage &&
      candidate &&
      lowerViewport &&
      normalVisualAttributionRejected &&
      obstruction,
  );
  const priorEvidence = partialEvidence.slice(0, candidateIndex).filter(
    (item): item is VisualBubbleEvidence => Boolean(item),
  );
  const prototypeAttribution = croppedCandidate
    ? resolveVisualBubbleAttributionFromEvidence(
        priorEvidence.map(messageForEvidence),
        priorEvidence,
      )
    : null;
  const prototypes = prototypeAttribution
    ? getPrototypeColors(priorEvidence, prototypeAttribution)
    : null;
  const prototypeSpeakers = new Map(
    prototypeAttribution?.diagnostics.map((item) => [item.id, item.speaker]) ?? [],
  );
  const meSourceCount = [...prototypeSpeakers.values()].filter((speaker) => speaker === "me").length;
  const themSourceCount = [...prototypeSpeakers.values()].filter((speaker) => speaker === "them").length;
  const meDistance = candidate && prototypes ? colorDistance(candidate.bubbleColor, prototypes.me) : null;
  const themDistance = candidate && prototypes ? colorDistance(candidate.bubbleColor, prototypes.them) : null;
  const bestDistance = meDistance === null || themDistance === null ? null : Math.min(meDistance, themDistance);
  const separationMargin = meDistance === null || themDistance === null ? null : Math.abs(meDistance - themDistance);
  const confidence = bestDistance === null || !prototypeAttribution ? null : clamp(prototypeAttribution.confidence - bestDistance / 220);
  const uniqueMatch = Boolean(
    bestDistance !== null &&
      separationMargin !== null &&
      confidence !== null &&
      bestDistance <= CROPPED_PROTOTYPE_MAX_DISTANCE &&
      separationMargin >= CROPPED_PROTOTYPE_MIN_MARGIN &&
      confidence >= 0.68,
  );

  return {
    candidateId: candidateMessage?.id ?? null,
    candidateIndex: candidateMessage ? candidateIndex : null,
    candidateIsChronologicallyLast: Boolean(candidateMessage),
    candidateEvidenceReady: Boolean(candidate),
    composerOverlayDetected,
    croppedCandidate,
    edgeCoverageDetected,
    finalBounds: candidateMessage ? {
      normalizedBottom: Number(((candidateMessage.boundingBox.y + candidateMessage.boundingBox.height) / height).toFixed(3)),
      normalizedTop: Number((candidateMessage.boundingBox.y / height).toFixed(3)),
    } : null,
    lowerProbeCoverage: lowerSamples.map((sample) => Number(sample.coverage.toFixed(3))),
    lowerViewport,
    normalVisualAttributionRejected,
    obstruction,
    prototype: {
      candidateToMeDistance: meDistance === null ? null : Number(meDistance.toFixed(3)),
      candidateToThemDistance: themDistance === null ? null : Number(themDistance.toFixed(3)),
      confidence: confidence === null ? null : Number(confidence.toFixed(3)),
      meSourceCount,
      separationMargin: separationMargin === null ? null : Number(separationMargin.toFixed(3)),
      themSourceCount,
      uniqueMatch,
    },
  };
}

function getVisuallyContinuousPairs(
  messages: DetectedMessage[],
  evidence: VisualBubbleEvidence[],
  attribution: VisualBubbleAttribution,
  sampleMap: Map<string, ImageColorSample>,
  pageColor: RgbColor,
): Pick<VisualBubbleAttributionAttempt, "continuityDiagnostics"> & {
  pairs: VisualBubbleAttribution["continuousPairs"];
} {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const visualById = new Map(
    attribution.diagnostics.map((item) => [item.id, item]),
  );

  const pairs: VisualBubbleAttribution["continuousPairs"] = [];
  const continuityDiagnostics: VisualBubbleAttributionAttempt["continuityDiagnostics"] = [];

  for (const [index, first] of messages.slice(0, -1).entries()) {
    const second = messages[index + 1];
    const firstVisual = visualById.get(first.id);
    const secondVisual = visualById.get(second.id);
    const firstEvidence = evidenceById.get(first.id);
    const secondEvidence = evidenceById.get(second.id);
    const bridgeSamples = [0, 1, 2]
      .map((bridgeIndex) =>
        sampleMap.get(`bridge:${first.id}:${second.id}:${bridgeIndex}`),
      )
      .filter((sample): sample is ImageColorSample => Boolean(sample));

    if (!firstVisual || !secondVisual || firstVisual.cluster !== secondVisual.cluster) {
      continuityDiagnostics.push({
        firstId: first.id,
        nearestBubbleDistance: null,
        outcome: "different-visual-cluster",
        pageDistance: null,
        secondId: second.id,
      });
      continue;
    }

    if (!firstEvidence || !secondEvidence || bridgeSamples.length === 0) {
      continuityDiagnostics.push({
        firstId: first.id,
        nearestBubbleDistance: null,
        outcome: "missing-bridge-sample",
        pageDistance: null,
        secondId: second.id,
      });
      continue;
    }

    const bridgeDistances = bridgeSamples.map((bridge) => {
      const bridgeColor = asColor(bridge);

      return {
        nearestBubbleDistance: Math.min(
          colorDistance(bridgeColor, firstEvidence.bubbleColor),
          colorDistance(bridgeColor, secondEvidence.bubbleColor),
        ),
        pageDistance: colorDistance(bridgeColor, pageColor),
      };
    });
    const nearestBubbleDistance = Math.min(
      ...bridgeDistances.map((sample) => sample.nearestBubbleDistance),
    );
    const pageDistance = Math.min(
      ...bridgeDistances.map((sample) => sample.pageDistance),
    );
    const accepted = isVisuallyContinuousBridge(bridgeDistances);
    const pageLikeSamples = bridgeDistances.filter(
      (sample) => sample.pageDistance < VISUAL_PAGE_DISTANCE,
    ).length;
    const outcome = accepted
      ? "accepted"
      : pageLikeSamples >= Math.ceil(bridgeDistances.length / 2)
        ? "bridge-page-like"
        : "bridge-style-mismatch";
    continuityDiagnostics.push({
      firstId: first.id,
      nearestBubbleDistance: Number(nearestBubbleDistance.toFixed(1)),
      outcome,
      pageDistance: Number(pageDistance.toFixed(1)),
      secondId: second.id,
    });

    if (accepted) {
      pairs.push({ firstId: first.id, secondId: second.id });
    }
  }

  return { continuityDiagnostics, pairs };
}

export async function resolveVisualBubbleAttribution({ messages, screenshotUri }: { messages: DetectedMessage[]; screenshotUri: string }): Promise<VisualBubbleAttribution | null> {
  const attempt = await inspectVisualBubbleAttribution({ messages, screenshotUri });
  return attempt.attribution;
}

export async function inspectVisualBubbleAttribution({ messages, screenshotUri }: { messages: DetectedMessage[]; screenshotUri: string }): Promise<VisualBubbleAttributionAttempt> {
  if (messages.length < 2) {
    return { attribution: null, continuityDiagnostics: [], croppedFallback: null, evidenceDiagnostics: [], outcome: "insufficient-messages" };
  }
  const dimensions = await sampleImageRegions(screenshotUri, [{ id: "dimensions", radius: 1, x: 0, y: 0 }]);
  if (!dimensions || dimensions.width < 40 || dimensions.height < 40) {
    return { attribution: null, continuityDiagnostics: [], croppedFallback: null, evidenceDiagnostics: [], outcome: "dimensions-unavailable" };
  }
  const sampled = await sampleImageRegions(screenshotUri, getRegions(messages, dimensions.width, dimensions.height));
  if (!sampled) {
    return { attribution: null, continuityDiagnostics: [], croppedFallback: null, evidenceDiagnostics: [], outcome: "samples-unavailable" };
  }
  const { evidence, evidenceDiagnostics, pageColor, partialEvidence, sampleMap } = deriveEvidence(
    messages,
    sampled.samples,
    sampled.width,
  );
  const baseAttribution = evidence
    ? resolveVisualBubbleAttributionFromEvidence(messages, evidence)
    : null;
  const continuity = baseAttribution && evidence
    ? getVisuallyContinuousPairs(
        messages,
        evidence,
        baseAttribution,
        sampleMap,
        pageColor,
      )
    : { continuityDiagnostics: [], pairs: [] };
  const attribution =
    baseAttribution && evidence
      ? {
          ...baseAttribution,
          continuousPairs: continuity.pairs,
        }
      : null;
  const croppedFallback = attribution
    ? null
    : getCroppedBottomFallback({
        height: sampled.height,
        messages,
        pageColor,
        partialEvidence,
        sampleMap,
      });
  const croppedCandidateDiagnostics = getCroppedCandidateDiagnostics({
    attribution,
    height: sampled.height,
    messages,
    pageColor,
    partialEvidence,
    sampleMap,
  });

  return {
    attribution,
    continuityDiagnostics: continuity.continuityDiagnostics,
    croppedCandidateDiagnostics,
    croppedFallback,
    evidenceDiagnostics: attribution || !evidence
      ? evidenceDiagnostics
      : evidenceDiagnostics.map((item) => ({
          ...item,
          outcome: "style-clusters-or-layout-not-confident" as const,
        })),
    outcome: attribution
      ? "accepted"
      : "low-confidence-or-incomplete-bubble-evidence",
  };
}
