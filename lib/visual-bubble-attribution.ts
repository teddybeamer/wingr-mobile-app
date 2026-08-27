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
  diagnostics: VisualBubbleAttributionDiagnostic[];
  messages: DetectedMessage[];
};

export type VisualBubbleAttributionAttempt = {
  attribution: VisualBubbleAttribution | null;
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

function getRegions(messages: DetectedMessage[], imageWidth: number): ImageSampleRegion[] {
  return messages.flatMap((message) => {
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
    if (!bubble || colorDistance(asColor(bubble), pageColor) < 14) {
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
  };
}

export async function resolveVisualBubbleAttribution({ messages, screenshotUri }: { messages: DetectedMessage[]; screenshotUri: string }): Promise<VisualBubbleAttribution | null> {
  const attempt = await inspectVisualBubbleAttribution({ messages, screenshotUri });
  return attempt.attribution;
}

export async function inspectVisualBubbleAttribution({ messages, screenshotUri }: { messages: DetectedMessage[]; screenshotUri: string }): Promise<VisualBubbleAttributionAttempt> {
  if (messages.length < 2) {
    return { attribution: null, evidenceDiagnostics: [], outcome: "insufficient-messages" };
  }
  const dimensions = await sampleImageRegions(screenshotUri, [{ id: "dimensions", radius: 1, x: 0, y: 0 }]);
  if (!dimensions || dimensions.width < 40 || dimensions.height < 40) {
    return { attribution: null, evidenceDiagnostics: [], outcome: "dimensions-unavailable" };
  }
  const sampled = await sampleImageRegions(screenshotUri, getRegions(messages, dimensions.width));
  if (!sampled) {
    return { attribution: null, evidenceDiagnostics: [], outcome: "samples-unavailable" };
  }
  const { evidence, evidenceDiagnostics } = deriveEvidence(
    messages,
    sampled.samples,
    sampled.width,
  );
  const attribution = evidence
    ? resolveVisualBubbleAttributionFromEvidence(messages, evidence)
    : null;

  return {
    attribution,
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
