import type {
  Rect,
  Text as RecognizedText,
} from "@infinitered/react-native-mlkit-text-recognition";
import type {
  DetectedMessage,
  MessageSender,
  MessageSpeaker,
  MessageXPosition,
  MessageLanguageEvidence,
  OcrResult,
  ParsedConversation,
  StructuredConversationMessage,
} from "../types/wingr";
import {
  getVisualBubbleRecoveryCommitDiagnostics,
  inspectVisualBubbleAttribution,
  inspectVisualBubbleRecovery,
  shouldCommitVisualBubbleRecovery,
  type VisualBubbleRecoveryDiagnostics,
  type VisualBubbleRecoveryFragment,
} from "./visual-bubble-attribution";
import {
  createContentFreeDiagnosticTrace,
  getDiagnosticDurationMs,
  getMonotonicTimeMs,
  startContentFreeDiagnosticStage,
  type ContentFreeDiagnosticTrace,
} from "./content-free-diagnostics";

export type OcrLineInput = {
  text: string;
  frame: Rect;
  recognizedLanguages?: string[];
};

type OcrLine = OcrLineInput & {
  id: string;
};

type Bubble = {
  id: string;
  lines: OcrLine[];
  frame: Rect;
};

type ColumnId = "left" | "right";

type ChatColumn = {
  id: ColumnId;
  center: number;
  members: Bubble[];
};

type ColumnAssignment = {
  column: ColumnId | null;
  confidence: number;
};

type ColumnMapping = {
  confidence: number;
  meColumn: ColumnId | null;
  resolved: boolean;
};

type ParsedMessageLayout = {
  geometryAmbiguous: boolean;
  groupLineIndexes: Record<string, number[]>;
  mapping: ColumnMapping;
  messages: DetectedMessage[];
};

type ConversationGeometry = {
  minLeft: number;
  maxRight: number;
  minTop: number;
  maxBottom: number;
  width: number;
  height: number;
};

type OcrLineAttributionDiagnostic = {
  characterCount: number;
  classification: "conversation" | "ui";
  hasLetters: boolean;
  hasNumbers: boolean;
  hasSentencePunctuation: boolean;
  normalizedCenterX: number;
  normalizedLeft: number;
  normalizedRight: number;
  normalizedBottom: number;
  normalizedTop: number;
  normalizedWidth: number;
  ocrIndex: number;
  reason: string;
  wordCount: number;
};

type GeometryAttributionDiagnostic = {
  confidence: number;
  geometrySpeaker: MessageSender;
  groupIndex: number;
  id: string;
  ocrLineIndexes: number[];
  normalizedCenterX: number;
  normalizedLeft: number;
  normalizedRight: number;
  normalizedBottom: number;
  normalizedTop: number;
  normalizedWidth: number;
};

type ReconstructionAttributionDiagnostics = {
  cleanedLineCount: number;
  geometryGroups: GeometryAttributionDiagnostic[];
  groupedMessageCount: number;
  lines: OcrLineAttributionDiagnostic[];
  rawLineCount: number;
  recoverableLineIndexes: number[];
};

export type OcrPipelineDiagnosticDependencies = {
  inspectAttribution?: typeof inspectVisualBubbleAttribution;
  inspectRecovery?: typeof inspectVisualBubbleRecovery;
  recognizeText?: (screenshotUri: string) => Promise<RecognizedText>;
  trace?: ContentFreeDiagnosticTrace;
};

let ocrTraceSequence = 0;

function nextOcrTraceId() {
  ocrTraceSequence += 1;
  return `ocr-${ocrTraceSequence}`;
}

const UI_LABELS = new Set([
  "back",
  "chat",
  "chats",
  "contact",
  "contacts",
  "delivered",
  "done",
  "edit",
  "imessage",
  "message",
  "messages",
  "now",
  "online",
  "profil",
  "profile",
  "read",
  "search",
  "send",
  "sent",
  "today",
  "typing",
  "yesterday",
]);

function getWidth(frame: Rect) {
  return frame.right - frame.left;
}

function getHeight(frame: Rect) {
  return frame.bottom - frame.top;
}

function getCenterX(frame: Rect) {
  return frame.left + getWidth(frame) / 2;
}

function getBoundingBox(frame: Rect): DetectedMessage["boundingBox"] {
  return {
    height: getHeight(frame),
    width: getWidth(frame),
    x: frame.left,
    y: frame.top,
  };
}

function getSpeakerFromSender(sender: MessageSender): MessageSpeaker {
  if (sender === "me") {
    return "user";
  }

  if (sender === "them") {
    return "other";
  }

  return "unknown";
}

function getFrameFromBoundingBox(
  boundingBox: DetectedMessage["boundingBox"],
): Rect {
  return {
    bottom: boundingBox.y + boundingBox.height,
    left: boundingBox.x,
    right: boundingBox.x + boundingBox.width,
    top: boundingBox.y,
  };
}

function normalizeText(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguageTag(tag: string) {
  const normalized = tag.trim().replace(/_/g, "-").toLowerCase();

  return normalized && normalized !== "und" ? normalized : null;
}

function normalizeForLookup(text: string) {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function getWordTokens(text: string) {
  return normalizeForLookup(text).split(" ").filter(Boolean);
}

function getDigitGroups(text: string) {
  return normalizeText(text).match(/\d{1,4}/g) ?? [];
}

function isStandaloneTimestamp(text: string) {
  const normalized = normalizeText(text).toLowerCase();

  return (
    /^\d{1,2}:\d{2}$/.test(normalized) ||
    /^\d{1,2}\.\d{2}$/.test(normalized) ||
    /^\d{1,2}:\d{2}\s?(am|pm)$/.test(normalized) ||
    /^\d{1,2}\.\d{2}\s?(am|pm)$/.test(normalized) ||
    /^(today|yesterday)\s+\d{1,2}:\d{2}(\s?(am|pm))?$/.test(normalized) ||
    /^(today|yesterday)\s+\d{1,2}\.\d{2}(\s?(am|pm))?$/.test(normalized) ||
    /^(mon|tue|wed|thu|fri|sat|sun),?\s+\d{1,2}[:.]\d{2}(\s?(am|pm))?$/.test(
      normalized,
    )
  );
}

function isStatusBarNoise(text: string) {
  const normalized = normalizeText(text);

  return (
    /^\d{1,3}%$/.test(normalized) ||
    /^[LTE5GWiFi\s]+$/i.test(normalized) ||
    /^(no service|carrier|battery)$/i.test(normalized)
  );
}

function isOutgoingReceiptLine(text: string) {
  const normalized = normalizeText(text).toLowerCase();

  return (
    /^(delivered|read|seen|sent|opened)(\s+\d{1,2}[:.]\d{2}(\s?(am|pm))?)?$/.test(
      normalized,
    ) || /^(✓|✓✓)$/.test(normalized)
  );
}

function isDateDivider(text: string) {
  const normalized = normalizeForLookup(text);

  return UI_LABELS.has(normalized) || isDateLikeMetadata(text);
}

function isDateLikeMetadata(text: string) {
  const normalized = normalizeText(text);
  const tokens = getWordTokens(text);
  const digitGroups = getDigitGroups(text);
  const alphaTokens = tokens.filter((token) => /\p{L}/u.test(token));
  const hasDateSeparators = /[./-]/.test(normalized);
  const hasSentencePunctuation = /[?!]$/.test(normalized);
  const alphaTokensLookLikeDateParts =
    alphaTokens.length <= 3 && alphaTokens.every((token) => token.length <= 10);

  return (
    normalized.length <= 34 &&
    tokens.length <= 6 &&
    digitGroups.length >= 2 &&
    alphaTokensLookLikeDateParts &&
    !hasSentencePunctuation &&
    (hasDateSeparators || alphaTokens.length > 0)
  );
}

function looksLikeHeaderName(
  text: string,
  frame: Rect,
  geometry: ConversationGeometry,
) {
  const normalized = normalizeText(text);
  const topRatio = (frame.top - geometry.minTop) / Math.max(geometry.height, 1);
  const widthRatio = getWidth(frame) / Math.max(geometry.width, 1);
  const centerDistance = Math.abs(
    getCenterX(frame) - (geometry.minLeft + geometry.width / 2),
  );
  const nearCenter = centerDistance < geometry.width * 0.25;
  const words = normalized.split(" ");
  const isShortTitle = words.length <= 4 && normalized.length <= 34;
  const hasSentenceShape =
    /[?.!,:;]$/.test(normalized) || normalized.length > 34;

  return (
    topRatio < 0.18 &&
    nearCenter &&
    widthRatio < 0.55 &&
    isShortTitle &&
    !hasSentenceShape
  );
}

function getObviousUiReason(
  line: OcrLine,
  geometry: ConversationGeometry,
) {
  const text = line.text;

  if (!text || text.length <= 1) {
    return "empty-or-single-character";
  }

  if (isStandaloneTimestamp(text)) {
    return "timestamp";
  }

  if (isStatusBarNoise(text)) {
    return "status-bar";
  }

  if (isDateDivider(text)) {
    return "date-divider";
  }

  if (isOutgoingReceiptLine(text)) {
    return "outgoing-receipt";
  }

  const topRatio =
    (line.frame.top - geometry.minTop) / Math.max(geometry.height, 1);
  const leftRatio =
    (line.frame.left - geometry.minLeft) / Math.max(geometry.width, 1);
  const widthRatio = getWidth(line.frame) / Math.max(geometry.width, 1);
  const words = normalizeText(text).split(" ").filter(Boolean);

  // Compact outer-edge controls in a chat header are not conversation text,
  // even when OCR represents a glyph as a short alphabetic-looking token.
  if (
    topRatio < 0.15 &&
    leftRatio > 0.8 &&
    widthRatio < 0.18 &&
    words.length <= 3 &&
    text.length <= 10
  ) {
    return "header-control";
  }

  if (/^[<›‹ chevron]+$/i.test(text)) {
    return "navigation-control";
  }

  return looksLikeHeaderName(text, line.frame, geometry)
    ? "header-name"
    : null;
}

function getLineGeometry(lines: OcrLine[]): ConversationGeometry {
  const minLeft = Math.min(...lines.map((line) => line.frame.left));
  const maxRight = Math.max(...lines.map((line) => line.frame.right));
  const minTop = Math.min(...lines.map((line) => line.frame.top));
  const maxBottom = Math.max(...lines.map((line) => line.frame.bottom));

  return {
    minLeft,
    maxRight,
    minTop,
    maxBottom,
    width: Math.max(maxRight - minLeft, 1),
    height: Math.max(maxBottom - minTop, 1),
  };
}

function flattenLines(recognizedText: RecognizedText): OcrLine[] {
  return recognizedText.blocks
    .flatMap((block) => block.lines)
    .map((line, index) => ({
      id: `line-${index + 1}`,
      frame: line.frame,
      recognizedLanguages: line.recognizedLanguages,
      text: normalizeText(line.text),
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => {
      const topDelta = a.frame.top - b.frame.top;

      if (Math.abs(topDelta) > 8) {
        return topDelta;
      }

      return a.frame.left - b.frame.left;
    });
}

function normalizedLineDiagnostic(
  line: OcrLine,
  geometry: ConversationGeometry,
  classification: OcrLineAttributionDiagnostic["classification"],
  reason: string,
): OcrLineAttributionDiagnostic {
  const width = Math.max(geometry.width, 1);
  const height = Math.max(geometry.height, 1);

  return {
    characterCount: line.text.length,
    classification,
    hasLetters: /\p{L}/u.test(line.text),
    hasNumbers: /\p{N}/u.test(line.text),
    hasSentencePunctuation: /[?.!,]$/.test(line.text),
    normalizedCenterX: Number(
      ((getCenterX(line.frame) - geometry.minLeft) / width).toFixed(3),
    ),
    normalizedLeft: Number(
      ((line.frame.left - geometry.minLeft) / width).toFixed(3),
    ),
    normalizedRight: Number(
      ((line.frame.right - geometry.minLeft) / width).toFixed(3),
    ),
    normalizedBottom: Number(
      ((line.frame.bottom - geometry.minTop) / height).toFixed(3),
    ),
    normalizedTop: Number(
      ((line.frame.top - geometry.minTop) / height).toFixed(3),
    ),
    normalizedWidth: Number((getWidth(line.frame) / width).toFixed(3)),
    ocrIndex: Number(line.id.replace("line-", "")),
    reason,
    wordCount: normalizeText(line.text).split(" ").filter(Boolean).length,
  };
}

function cleanOcrLines(
  lines: OcrLine[],
  diagnostics?: OcrLineAttributionDiagnostic[],
) {
  if (lines.length === 0) {
    return [];
  }

  const geometry = getLineGeometry(lines);
  const filteredLines = lines.filter((line) => {
    const obviousUiReason = getObviousUiReason(line, geometry);

    if (obviousUiReason) {
      diagnostics?.push(
        normalizedLineDiagnostic(line, geometry, "ui", obviousUiReason),
      );
      return false;
    }

    const bottomRatio =
      (line.frame.bottom - geometry.minTop) / Math.max(geometry.height, 1);

    if (bottomRatio >= 0.94 && !looksLikeConversationText(line.text)) {
      diagnostics?.push(
        normalizedLineDiagnostic(line, geometry, "ui", "bottom-composer"),
      );
      return false;
    }

    return true;
  });

  const retainedLines = stripTopChrome(filteredLines, diagnostics, geometry);

  for (const line of retainedLines) {
    diagnostics?.push(
      normalizedLineDiagnostic(line, geometry, "conversation", "retained"),
    );
  }

  return retainedLines;
}

function looksLikeConversationText(text: string) {
  const normalized = normalizeText(text);
  const words = normalized.split(" ").filter(Boolean);

  return (
    normalized.length >= 18 || words.length >= 4 || /[?.!,]$/.test(normalized)
  );
}

function stripTopChrome(
  lines: OcrLine[],
  diagnostics?: OcrLineAttributionDiagnostic[],
  sourceGeometry?: ConversationGeometry,
) {
  const firstConversationIndex = lines.findIndex(
    (line) =>
      /[\p{L}\p{N}]/u.test(line.text) && looksLikeConversationText(line.text),
  );

  if (firstConversationIndex <= 0) {
    return lines;
  }

  const geometry = sourceGeometry ?? getLineGeometry(lines);
  const headerBoundary = geometry.minTop + geometry.height * 0.14;

  return lines.filter((line, index) => {
    if (index >= firstConversationIndex) {
      return true;
    }

    const normalized = normalizeText(line.text);
    const words = normalized.split(" ").filter(Boolean);
    const hasMessagePunctuation = /[?.!,]$/.test(normalized);
    const hasReadableContent = /[\p{L}\p{N}]/u.test(normalized);

    // Header controls such as a three-dot menu can be recognized as "...".
    // Keep real, short opening messages below the header, but never promote a
    // punctuation-only control into a chat bubble.
    const keep =
      hasReadableContent &&
      (line.frame.top >= headerBoundary ||
        normalized.length > 22 ||
        words.length > 3 ||
        hasMessagePunctuation);

    if (!keep) {
      diagnostics?.push(
        normalizedLineDiagnostic(line, geometry, "ui", "top-chrome"),
      );
    }

    return keep;
  });
}

function unionFrame(lines: OcrLine[]): Rect {
  return {
    bottom: Math.max(...lines.map((line) => line.frame.bottom)),
    left: Math.min(...lines.map((line) => line.frame.left)),
    right: Math.max(...lines.map((line) => line.frame.right)),
    top: Math.min(...lines.map((line) => line.frame.top)),
  };
}

function bubbleText(bubble: Bubble) {
  return bubble.lines
    .map((line) => line.text)
    .join(" ")
    .replace(/\s+([?.!,])/g, "$1");
}

function getLineLanguageTag(line: OcrLine) {
  const tags = new Set(
    (line.recognizedLanguages ?? [])
      .map(normalizeLanguageTag)
      .filter((tag): tag is string => Boolean(tag)),
  );

  return tags.size === 1 ? [...tags][0] : null;
}

function getBubbleLanguageEvidence(
  bubble: Bubble,
): MessageLanguageEvidence[] {
  const counts = new Map<string, number>();

  for (const line of bubble.lines) {
    const tag = getLineLanguageTag(line);

    if (tag) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, lineCount]) => ({ lineCount, tag }))
    .sort(
      (first, second) =>
        second.lineCount - first.lineCount || first.tag.localeCompare(second.tag),
    );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function horizontalOverlapRatio(first: Rect, second: Rect) {
  const overlap =
    Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const smallerWidth = Math.min(getWidth(first), getWidth(second));

  return Math.max(overlap, 0) / Math.max(smallerWidth, 1);
}

function getBubbleMergeScore(
  bubble: Bubble,
  nextLine: OcrLine,
  geometry: ConversationGeometry,
  typicalLineHeight: number,
) {
  const previousLine = bubble.lines[bubble.lines.length - 1];
  const verticalGap = nextLine.frame.top - previousLine.frame.bottom;
  const lineHeight = Math.max(
    getHeight(previousLine.frame),
    getHeight(nextLine.frame),
    typicalLineHeight,
    10,
  );
  const maximumWrappedLineGap = Math.max(3, lineHeight * 0.45);

  if (verticalGap < -lineHeight * 0.35 || verticalGap > maximumWrappedLineGap) {
    return null;
  }

  const leftDelta = Math.abs(previousLine.frame.left - nextLine.frame.left);
  const rightDelta = Math.abs(previousLine.frame.right - nextLine.frame.right);
  const edgeTolerance = Math.max(8, geometry.width * 0.07);
  const overlap = horizontalOverlapRatio(previousLine.frame, nextLine.frame);
  const alignedEdges = Math.min(leftDelta, rightDelta) <= edgeTolerance;

  if (!alignedEdges && overlap < 0.45) {
    return null;
  }

  const alignmentScore = alignedEdges ? 2 : 1;
  const overlapScore = overlap >= 0.6 ? 1 : 0;
  const gapScore =
    1 - Math.max(verticalGap, 0) / Math.max(maximumWrappedLineGap, 1);

  return alignmentScore + overlapScore + gapScore;
}

function groupLinesIntoBubbles(lines: OcrLine[]) {
  if (lines.length === 0) {
    return [];
  }

  const geometry = getLineGeometry(lines);
  const typicalLineHeight = median(
    lines.map((line) => Math.max(getHeight(line.frame), 10)),
  );
  const bubbles: Bubble[] = [];

  for (const line of lines) {
    let bestBubble: Bubble | null = null;
    let bestScore = -Infinity;

    for (const bubble of bubbles) {
      const score = getBubbleMergeScore(
        bubble,
        line,
        geometry,
        typicalLineHeight,
      );

      if (score !== null && score > bestScore) {
        bestBubble = bubble;
        bestScore = score;
      }
    }

    if (bestBubble) {
      bestBubble.lines.push(line);
      bestBubble.frame = unionFrame(bestBubble.lines);
    } else {
      bubbles.push({
        frame: { ...line.frame },
        id: `bubble-${bubbles.length + 1}`,
        lines: [line],
      });
    }
  }

  return bubbles;
}

function learnChatColumns(
  bubbles: Bubble[],
  geometry: ConversationGeometry,
): ChatColumn[] {
  if (bubbles.length === 0) {
    return [];
  }

  const centers = bubbles.map((bubble) => getCenterX(bubble.frame));
  const leftSeed = Math.min(...centers);
  const rightSeed = Math.max(...centers);
  const minimumSeparation = Math.max(24, geometry.width * 0.14);

  if (bubbles.length < 2 || rightSeed - leftSeed < minimumSeparation) {
    return [{ id: "left", center: median(centers), members: bubbles }];
  }

  let leftCenter = leftSeed;
  let rightCenter = rightSeed;
  let leftMembers: Bubble[] = [];
  let rightMembers: Bubble[] = [];

  for (let iteration = 0; iteration < 4; iteration += 1) {
    leftMembers = [];
    rightMembers = [];

    for (const bubble of bubbles) {
      const center = getCenterX(bubble.frame);

      if (Math.abs(center - leftCenter) <= Math.abs(center - rightCenter)) {
        leftMembers.push(bubble);
      } else {
        rightMembers.push(bubble);
      }
    }

    if (leftMembers.length === 0 || rightMembers.length === 0) {
      return [{ id: "left", center: median(centers), members: bubbles }];
    }

    leftCenter = median(leftMembers.map((bubble) => getCenterX(bubble.frame)));
    rightCenter = median(
      rightMembers.map((bubble) => getCenterX(bubble.frame)),
    );
  }

  if (rightCenter - leftCenter < minimumSeparation) {
    return [{ id: "left", center: median(centers), members: bubbles }];
  }

  return [
    { id: "left", center: leftCenter, members: leftMembers },
    { id: "right", center: rightCenter, members: rightMembers },
  ];
}

function assignBubbleToColumn(
  bubble: Bubble,
  columns: ChatColumn[],
): ColumnAssignment {
  if (columns.length === 0) {
    return { column: null, confidence: 0 };
  }

  if (columns.length === 1) {
    return { column: columns[0].id, confidence: 0.72 };
  }

  const [leftColumn, rightColumn] = columns;
  const center = getCenterX(bubble.frame);
  const leftDistance = Math.abs(center - leftColumn.center);
  const rightDistance = Math.abs(center - rightColumn.center);
  const nearestColumn =
    leftDistance <= rightDistance ? leftColumn : rightColumn;
  const nearestDistance = Math.min(leftDistance, rightDistance);
  const otherDistance = Math.max(leftDistance, rightDistance);
  const separation = Math.max(
    Math.abs(rightColumn.center - leftColumn.center),
    1,
  );
  const discrimination = Math.max(
    0,
    Math.min(1, (otherDistance - nearestDistance) / separation),
  );

  return {
    column: nearestColumn.id,
    confidence: 0.38 + discrimination * 0.57,
  };
}

function findOutgoingAnchorBubbleIds(
  rawLines: OcrLine[],
  bubbles: Bubble[],
  geometry: ConversationGeometry,
) {
  const anchors = new Set<string>();
  const maximumReceiptGap = Math.max(
    42,
    median(bubbles.map((bubble) => getHeight(bubble.frame))) * 2.5,
  );

  for (const receipt of rawLines) {
    if (!isOutgoingReceiptLine(receipt.text)) {
      continue;
    }

    const candidates = bubbles
      .map((bubble) => {
        const verticalGap = receipt.frame.top - bubble.frame.bottom;
        const rightDelta = Math.abs(receipt.frame.right - bubble.frame.right);
        const centerDelta = Math.abs(
          getCenterX(receipt.frame) - getCenterX(bubble.frame),
        );
        const horizontallyAligned =
          rightDelta <= geometry.width * 0.24 ||
          centerDelta <= geometry.width * 0.22;

        return { bubble, horizontallyAligned, verticalGap };
      })
      .filter(
        (candidate) =>
          candidate.verticalGap >= -4 &&
          candidate.verticalGap <= maximumReceiptGap &&
          candidate.horizontallyAligned,
      )
      .sort((first, second) => first.verticalGap - second.verticalGap);

    if (candidates[0]) {
      anchors.add(candidates[0].bubble.id);
    }
  }

  return anchors;
}

function resolveColumnMapping(
  columns: ChatColumn[],
  bubbles: Bubble[],
  outgoingAnchorBubbleIds: Set<string>,
): ColumnMapping {
  const anchorColumns = new Set<ColumnId>();

  for (const bubble of bubbles) {
    if (!outgoingAnchorBubbleIds.has(bubble.id)) {
      continue;
    }

    const assignment = assignBubbleToColumn(bubble, columns);

    if (assignment.column && assignment.confidence >= 0.6) {
      anchorColumns.add(assignment.column);
    }
  }

  if (anchorColumns.size === 1) {
    return {
      confidence: 0.95,
      meColumn: [...anchorColumns][0],
      resolved: true,
    };
  }

  if (anchorColumns.size > 1) {
    return { confidence: 0, meColumn: null, resolved: false };
  }

  if (columns.length === 2) {
    return {
      confidence: 0.82,
      meColumn: "right",
      resolved: true,
    };
  }

  return { confidence: 0, meColumn: null, resolved: false };
}

function isGeometryAttributionAmbiguous(
  columns: ChatColumn[],
  bubbles: Bubble[],
  geometry: ConversationGeometry,
  mapping: ColumnMapping,
) {
  if (!mapping.resolved || columns.length !== 2) {
    return true;
  }

  const centerSeparation = Math.abs(columns[1].center - columns[0].center);
  const typicalBubbleWidth = median(
    bubbles.map((bubble) => getWidth(bubble.frame)),
  );

  return (
    centerSeparation < geometry.width * 0.18 ||
    centerSeparation < typicalBubbleWidth * 0.35
  );
}

function parseMessages(
  lines: OcrLine[],
  rawLines: OcrLine[],
): ParsedMessageLayout {
  if (lines.length === 0) {
    return {
      geometryAmbiguous: true,
      groupLineIndexes: {},
      mapping: { confidence: 0, meColumn: null, resolved: false },
      messages: [],
    };
  }

  const bubbles = groupLinesIntoBubbles(lines);
  const geometry = getLineGeometry(lines);
  const columns = learnChatColumns(bubbles, geometry);
  const outgoingAnchorBubbleIds = findOutgoingAnchorBubbleIds(
    rawLines,
    bubbles,
    geometry,
  );
  const mapping = resolveColumnMapping(
    columns,
    bubbles,
    outgoingAnchorBubbleIds,
  );
  const geometryAmbiguous = isGeometryAttributionAmbiguous(
    columns,
    bubbles,
    geometry,
    mapping,
  );

  return {
    geometryAmbiguous,
    groupLineIndexes: Object.fromEntries(
      bubbles.map((bubble, index) => [
        `message-${index + 1}`,
        bubble.lines.map((line) => Number(line.id.replace("line-", ""))),
      ]),
    ),
    mapping,
    messages: bubbles
      .map((bubble, index) => {
        const assignment = assignBubbleToColumn(bubble, columns);
        const languageEvidence = getBubbleLanguageEvidence(bubble);
        const xPosition: MessageXPosition = assignment.column ?? "center";
        const sender =
          mapping.resolved && assignment.column
            ? assignment.column === mapping.meColumn
              ? ("me" as const)
              : ("them" as const)
            : ("unknown" as const);
        const confidence = mapping.resolved
          ? Math.min(0.98, mapping.confidence * assignment.confidence)
          : assignment.confidence * 0.35;

        return {
          boundingBox: getBoundingBox(bubble.frame),
          confidence,
          id: `message-${index + 1}`,
          sender,
          speaker: getSpeakerFromSender(sender),
          text: bubbleText(bubble),
          xPosition,
          ...(languageEvidence.length > 0 ? { languageEvidence } : {}),
        };
      })
      .filter((message) => message.text.length > 1),
  };
}

function buildStructuredConversation(
  messages: DetectedMessage[],
): StructuredConversationMessage[] {
  return messages.map((message) => ({
    speaker: message.sender,
    text: message.text,
  }));
}

export function mergeVisuallyContinuousMessages(
  messages: DetectedMessage[],
  continuousPairs: Array<{ firstId: string; secondId: string }>,
) {
  const continuations = new Set(
    continuousPairs.map((pair) => `${pair.firstId}:${pair.secondId}`),
  );

  return messages.reduce<DetectedMessage[]>((merged, message) => {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.sender === message.sender &&
      continuations.has(`${previous.id}:${message.id}`)
    ) {
      const previousRight = previous.boundingBox.x + previous.boundingBox.width;
      const messageRight = message.boundingBox.x + message.boundingBox.width;
      const previousBottom = previous.boundingBox.y + previous.boundingBox.height;
      const messageBottom = message.boundingBox.y + message.boundingBox.height;
      const left = Math.min(previous.boundingBox.x, message.boundingBox.x);
      const top = Math.min(previous.boundingBox.y, message.boundingBox.y);

      merged[merged.length - 1] = {
        ...previous,
        boundingBox: {
          height: Math.max(previousBottom, messageBottom) - top,
          width: Math.max(previousRight, messageRight) - left,
          x: left,
          y: top,
        },
        confidence: Math.min(previous.confidence, message.confidence),
        text: `${previous.text} ${message.text}`.replace(/\s+/g, " ").trim(),
      };
      return merged;
    }

    merged.push(message);
    return merged;
  }, []);
}

function formatTranscript(
  structuredConversation: StructuredConversationMessage[],
) {
  return structuredConversation
    .map((message) => `${message.speaker.toUpperCase()}: ${message.text}`)
    .join("\n");
}

function getLatestMessageSender(
  structuredConversation: StructuredConversationMessage[],
) {
  return (
    structuredConversation[structuredConversation.length - 1]?.speaker ??
    "unknown"
  );
}

function getSpeakerAttributionConfidence(
  messages: DetectedMessage[],
  mapping: ColumnMapping,
) {
  if (messages.length === 0) {
    return 0;
  }

  const averageConfidence =
    messages.reduce((total, message) => total + message.confidence, 0) /
    messages.length;
  const unknownPenalty =
    (messages.filter((message) => message.sender === "unknown").length /
      messages.length) *
    0.35;
  const latestMessage = messages[messages.length - 1];
  const latestPenalty =
    latestMessage.sender === "unknown"
      ? 0.2
      : Math.max(0, 0.62 - latestMessage.confidence) * 0.35;

  return Math.max(
    0,
    Math.min(
      1,
      averageConfidence -
        unknownPenalty -
        latestPenalty +
        mapping.confidence * 0.12,
    ),
  );
}

export function buildParsedConversation(
  messages: DetectedMessage[],
  mapping: ColumnMapping = {
    confidence: messages.every((message) => message.sender !== "unknown")
      ? 0.9
      : 0,
    meColumn: null,
    resolved: messages.every((message) => message.sender !== "unknown"),
  },
): ParsedConversation {
  const structuredConversation = buildStructuredConversation(messages);
  const latestMessageSender = getLatestMessageSender(structuredConversation);

  return {
    latestMessageSender,
    messages,
    speakerAttributionResolved: mapping.resolved,
    shouldGenerateDirectReply: latestMessageSender === "them",
    speakerAttributionConfidence: getSpeakerAttributionConfidence(
      messages,
      mapping,
    ),
    structuredConversation,
  };
}

export function needsSpeakerConfirmation(
  parsedConversation: ParsedConversation,
) {
  return (
    !parsedConversation.speakerAttributionResolved ||
    parsedConversation.messages.length === 0
  );
}

function getMessageGeometry(messages: DetectedMessage[]) {
  const frames = messages.map((message) =>
    getFrameFromBoundingBox(message.boundingBox),
  );

  return {
    maxRight: Math.max(...frames.map((frame) => frame.right)),
    minLeft: Math.min(...frames.map((frame) => frame.left)),
  };
}

export function rebuildOcrResultWithConfirmedUserSide(
  ocr: OcrResult,
  userSide: "left" | "right",
): OcrResult {
  if (ocr.detectedMessages.length === 0) {
    return ocr;
  }

  const geometry = getMessageGeometry(ocr.detectedMessages);
  const midpoint =
    geometry.minLeft + (geometry.maxRight - geometry.minLeft) / 2;
  const messages = ocr.detectedMessages.map((message): DetectedMessage => {
    const frame = getFrameFromBoundingBox(message.boundingBox);
    const side = getCenterX(frame) >= midpoint ? "right" : "left";
    const sender: MessageSender = side === userSide ? "me" : "them";
    const midpointDistance =
      Math.abs(getCenterX(frame) - midpoint) /
      Math.max(geometry.maxRight - geometry.minLeft, 1);
    const confidence = Math.max(
      message.confidence,
      midpointDistance < 0.05 ? 0.72 : 0.9,
    );

    return {
      ...message,
      confidence,
      sender,
      speaker: getSpeakerFromSender(sender),
      xPosition: side,
    };
  });
  const parsedConversation = buildParsedConversation(messages, {
    confidence: 0.98,
    meColumn: userSide,
    resolved: true,
  });
  const transcriptText = formatTranscript(
    parsedConversation.structuredConversation,
  );

  return {
    ...ocr,
    confidence: parsedConversation.speakerAttributionConfidence,
    detectedMessages: messages,
    parsedConversation,
    transcriptText,
  };
}

export function reconstructConversationFromOcrLines(
  lineInputs: OcrLineInput[],
): OcrResult {
  return reconstructConversationFromOcrLinesWithDiagnostics(lineInputs).result;
}

export function reconstructVisualRecoveryFragmentsFromOcrLines(
  lineInputs: OcrLineInput[],
) {
  return reconstructConversationFromOcrLinesWithDiagnostics(lineInputs)
    .recoveryFragments;
}

function reconstructConversationFromOcrLinesWithDiagnostics(
  lineInputs: OcrLineInput[],
  trace?: ContentFreeDiagnosticTrace,
): {
  diagnostics: ReconstructionAttributionDiagnostics;
  recoveryFragments: VisualBubbleRecoveryFragment[];
  result: OcrResult;
} {
  const reconstructionStartedAt = getMonotonicTimeMs();
  const normalizationStartedAt = getMonotonicTimeMs();
  const rawLines = lineInputs
    .map((line, index) => ({
      frame: line.frame,
      id: `line-${index + 1}`,
      recognizedLanguages: line.recognizedLanguages,
      text: normalizeText(line.text),
    }))
    .filter((line) => line.text.length > 0)
    .sort((first, second) => {
      const topDelta = first.frame.top - second.frame.top;

      if (Math.abs(topDelta) > 8) {
        return topDelta;
      }

      return first.frame.left - second.frame.left;
    });
  trace?.("ocr.normalization.complete", {
    durationMs: getDiagnosticDurationMs(normalizationStartedAt),
    inputLineCount: lineInputs.length,
    rawLineCount: rawLines.length,
  });
  const lineDiagnostics: OcrLineAttributionDiagnostic[] = [];
  const filteringStartedAt = getMonotonicTimeMs();
  const cleanedLines = cleanOcrLines(rawLines, lineDiagnostics);
  trace?.("ocr.filtering.complete", {
    durationMs: getDiagnosticDurationMs(filteringStartedAt),
    inputItemCount: rawLines.length,
    outputItemCount: cleanedLines.length,
    removedItems: lineDiagnostics
      .filter((line) => line.classification === "ui")
      .map((line) => ({ ocrIndex: line.ocrIndex, reason: line.reason })),
  });
  const groupingStartedAt = getMonotonicTimeMs();
  const {
    geometryAmbiguous,
    groupLineIndexes,
    mapping,
    messages: detectedMessages,
  } = parseMessages(
    cleanedLines,
    rawLines,
  );
  trace?.("ocr.grouping.complete", {
    durationMs: getDiagnosticDurationMs(groupingStartedAt),
    groupedMessageCount: detectedMessages.length,
    inputItemCount: cleanedLines.length,
  });
  const parsedConversation = buildParsedConversation(detectedMessages, mapping);
  const conversationGeometry =
    cleanedLines.length > 0 ? getLineGeometry(cleanedLines) : null;
  const geometryGroups: GeometryAttributionDiagnostic[] = detectedMessages.map(
    (message, index) => {
      const frame = getFrameFromBoundingBox(message.boundingBox);
      const width = Math.max(conversationGeometry?.width ?? 1, 1);
      const height = Math.max(conversationGeometry?.height ?? 1, 1);
      const left = conversationGeometry?.minLeft ?? 0;
      const top = conversationGeometry?.minTop ?? 0;

      return {
        confidence: Number(message.confidence.toFixed(3)),
        geometrySpeaker: message.sender,
        groupIndex: index + 1,
        id: message.id,
        ocrLineIndexes: groupLineIndexes[message.id] ?? [],
        normalizedCenterX: Number(((getCenterX(frame) - left) / width).toFixed(3)),
        normalizedLeft: Number(((frame.left - left) / width).toFixed(3)),
        normalizedRight: Number(((frame.right - left) / width).toFixed(3)),
        normalizedBottom: Number(((frame.bottom - top) / height).toFixed(3)),
        normalizedTop: Number(((frame.top - top) / height).toFixed(3)),
        normalizedWidth: Number((getWidth(frame) / width).toFixed(3)),
      };
    },
  );
  const recoverableBottomLineIndexes = new Set(
    lineDiagnostics
      .filter((line) => line.reason === "bottom-composer")
      .map((line) => line.ocrIndex),
  );
  const recoveryFragments: VisualBubbleRecoveryFragment[] = [
    ...detectedMessages.map((message) => ({
      message,
      ocrLineIndexes: groupLineIndexes[message.id] ?? [],
      recoverable: false,
    })),
    ...rawLines
      .filter((line) =>
        recoverableBottomLineIndexes.has(Number(line.id.replace("line-", ""))),
      )
      .map((line) => {
        const bubble: Bubble = {
          frame: line.frame,
          id: `recovery-${line.id}`,
          lines: [line],
        };
        const languageEvidence = getBubbleLanguageEvidence(bubble);

        return {
          message: {
            boundingBox: getBoundingBox(line.frame),
            confidence: 0.2,
            id: `recovery-${line.id}`,
            sender: "unknown" as const,
            speaker: "unknown" as const,
            text: line.text,
            xPosition: "center" as const,
            ...(languageEvidence.length > 0 ? { languageEvidence } : {}),
          },
          ocrLineIndexes: [Number(line.id.replace("line-", ""))],
          recoverable: true,
        };
      }),
  ];

  trace?.("ocr.reconstruction.complete", {
    cleanedLineCount: cleanedLines.length,
    durationMs: getDiagnosticDurationMs(reconstructionStartedAt),
    geometryAmbiguous,
    groupedMessageCount: detectedMessages.length,
    rawLineCount: rawLines.length,
    recoverableLineIndexes: [...recoverableBottomLineIndexes].sort(
      (first, second) => first - second,
    ),
    recoveryFragmentCount: recoveryFragments.length,
  });

  return {
    diagnostics: {
      cleanedLineCount: cleanedLines.length,
      geometryGroups,
      groupedMessageCount: detectedMessages.length,
      lines: lineDiagnostics,
      rawLineCount: rawLines.length,
      recoverableLineIndexes: [...recoverableBottomLineIndexes].sort(
        (first, second) => first - second,
      ),
    },
    recoveryFragments,
    result: {
      confidence: parsedConversation.speakerAttributionConfidence,
      detectedMessages,
      geometryAttributionAmbiguous: geometryAmbiguous,
      parsedConversation,
      rawText: rawLines.map((line) => line.text).join("\n"),
      source: "onDevice",
      transcriptText: formatTranscript(parsedConversation.structuredConversation),
    },
  };
}

export async function extractChatTextFromImage(
  screenshotUri: string,
  correlationId?: string,
  diagnosticDependencies: OcrPipelineDiagnosticDependencies = {},
): Promise<OcrResult> {
  if (!screenshotUri) {
    throw new Error("No screenshot selected.");
  }

  const traceId = correlationId
    ? `${correlationId}.ocr`
    : nextOcrTraceId();
  const defaultTrace = createContentFreeDiagnosticTrace({
    label: "[Wingr OCR trace]",
    runId: traceId,
  });
  const trace: ContentFreeDiagnosticTrace = (stage, metadata = {}) => {
    try {
      if (diagnosticDependencies.trace) {
        diagnosticDependencies.trace(stage, { ...metadata, runId: traceId });
      } else {
        defaultTrace(stage, metadata);
      }
    } catch {
      // Diagnostics must never alter OCR or attribution behavior.
    }
  };
  const inspectAttribution =
    diagnosticDependencies.inspectAttribution ??
    inspectVisualBubbleAttribution;
  const inspectRecovery =
    diagnosticDependencies.inspectRecovery ?? inspectVisualBubbleRecovery;
  const pipelineStartedAt = getMonotonicTimeMs();
  let recognizedText: RecognizedText;
  let nativeOcrStage = "module-import";
  let activeNativeStage:
    | ReturnType<typeof startContentFreeDiagnosticStage>
    | null = null;

  trace("pipeline.started", { inputAvailable: true });

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[Wingr native OCR] started", {
      runId: traceId,
    });
  }

  try {
    activeNativeStage = startContentFreeDiagnosticStage({
      stage: "mlkit.module-import",
      trace,
    });
    const recognizeText = diagnosticDependencies.recognizeText
      ? diagnosticDependencies.recognizeText
      : (
          await import(
            "@infinitered/react-native-mlkit-text-recognition"
          )
        ).recognizeText;
    activeNativeStage.complete({
      moduleSource: diagnosticDependencies.recognizeText
        ? "diagnostic-injection"
        : "native-module",
    });
    activeNativeStage = null;

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] module ready", { runId: traceId });
    }

    nativeOcrStage = "recognition";
    activeNativeStage = startContentFreeDiagnosticStage({
      stage: "mlkit.recognition",
      trace,
    });
    recognizedText = await recognizeText(screenshotUri);
    const rawBlockCount = recognizedText.blocks.length;
    const rawLineCount = recognizedText.blocks.reduce(
      (total, block) => total + block.lines.length,
      0,
    );
    activeNativeStage.complete({ rawBlockCount, rawLineCount });
    activeNativeStage = null;

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] recognition ready", {
        blocks: rawBlockCount,
        lines: rawLineCount,
        runId: traceId,
      });
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown OCR error.";
    activeNativeStage?.fail({
      errorType: error instanceof Error ? error.name : "unknown",
      nativeOcrStage,
    });
    trace("pipeline.failed", {
      durationMs: getDiagnosticDurationMs(pipelineStartedAt),
      failureStage: nativeOcrStage,
    });

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] failed", {
        errorType: error instanceof Error ? error.name : "unknown",
        runId: traceId,
        stage: nativeOcrStage,
      });
    }

    throw new Error(
      `On-device OCR failed. Make sure you are using an Expo Development Build with Google ML Kit installed. ${detail}`,
    );
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[Wingr native OCR] reconstructing", { runId: traceId });
  }

  const flatteningStage = startContentFreeDiagnosticStage({
    stage: "ocr.flattening",
    trace,
  });
  const flattenedLines = flattenLines(recognizedText);
  flatteningStage.complete({ rawLineCount: flattenedLines.length });
  if (flattenedLines.length > 0) {
    const rawGeometry = getLineGeometry(flattenedLines);
    const rawHeight = Math.max(rawGeometry.height, 1);
    const rawWidth = Math.max(rawGeometry.width, 1);
    const rawLineGeometry = flattenedLines.map((line) => ({
      characterCount: line.text.length,
      normalizedBottom: Number(
        ((line.frame.bottom - rawGeometry.minTop) / rawHeight).toFixed(3),
      ),
      normalizedLeft: Number(
        ((line.frame.left - rawGeometry.minLeft) / rawWidth).toFixed(3),
      ),
      normalizedRight: Number(
        ((line.frame.right - rawGeometry.minLeft) / rawWidth).toFixed(3),
      ),
      normalizedTop: Number(
        ((line.frame.top - rawGeometry.minTop) / rawHeight).toFixed(3),
      ),
      ocrIndex: Number(line.id.replace("line-", "")),
      wordCount: normalizeText(line.text).split(" ").filter(Boolean).length,
    }));
    trace("mlkit.output-geometry", {
      bottomBandLineIndexes: rawLineGeometry
        .filter((line) => line.normalizedBottom >= 0.78)
        .map((line) => line.ocrIndex),
      lines: rawLineGeometry,
      rawBlockCount: recognizedText.blocks.length,
      rawLineCount: flattenedLines.length,
    });
  }

  const initialReconstruction = reconstructConversationFromOcrLinesWithDiagnostics(
    flattenedLines,
    trace,
  );
  let reconstruction = initialReconstruction.result;
  const rawText = recognizedText.text?.trim() ?? reconstruction.rawText;
  const visualTrace = (stage: string, metadata: Record<string, unknown>) => {
    trace(`visual.${stage}`, metadata);
  };
  let visualDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["attribution"]
    | null = null;
  let visualEvidenceDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["evidenceDiagnostics"] =
    [];
  let visualContinuityDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["continuityDiagnostics"] =
    [];
  let croppedFallback:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["croppedFallback"] =
    null;
  let croppedCandidateDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["croppedCandidateDiagnostics"] =
    undefined;
  let initialCroppedCandidateDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["croppedCandidateDiagnostics"] =
    undefined;
  let recoveredCroppedCandidateDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["croppedCandidateDiagnostics"] =
    undefined;
  let recoveredVisualAttemptOutcome = "not-attempted";
  let recoveryCommitDiagnostics:
    | ReturnType<typeof getVisualBubbleRecoveryCommitDiagnostics>
    | null = null;
  let recoveryDiagnostics: VisualBubbleRecoveryDiagnostics = {
    committed: false,
    entered: false,
    excludedFragmentIds: [],
    mergePairs: [],
    reconstructedCount: 0,
    recoveredOcrLineIndexes: [],
  };
  let visualAttemptOutcome = "not-attempted";
  let activeVisualStage:
    | ReturnType<typeof startContentFreeDiagnosticStage>
    | null = null;

  try {
    // OCR text geometry alone is not a reliable speaker signal for layouts
    // whose incoming and outgoing text starts at similar positions. A visual
    // result only replaces geometry when it independently clears the visual
    // module's confidence threshold; otherwise the established geometry result
    // remains untouched.
    activeVisualStage = startContentFreeDiagnosticStage({
      metadata: {
        inputItemCount: reconstruction.detectedMessages.length,
      },
      stage: "visual.normal",
      trace,
    });
    const visualAttempt =
      reconstruction.detectedMessages.length >= 2
        ? await inspectAttribution({
            messages: reconstruction.detectedMessages,
            screenshotUri,
            stagePrefix: "normal",
            trace: visualTrace,
          })
        : {
            attribution: null,
            continuityDiagnostics: [],
            croppedCandidateDiagnostics: undefined,
            croppedFallback: null,
            evidenceDiagnostics: [],
            outcome: "insufficient-messages" as const,
          };
    activeVisualStage.complete({ outcome: visualAttempt.outcome });
    activeVisualStage = null;
    let visualAttribution = visualAttempt.attribution;
    let attributionMessages = reconstruction.detectedMessages;
    let recoveryNeedsConfirmation = false;

    visualAttemptOutcome = visualAttempt.outcome;
    visualDiagnostics = visualAttribution;
    visualEvidenceDiagnostics = visualAttempt.evidenceDiagnostics;
    visualContinuityDiagnostics = visualAttempt.continuityDiagnostics;
    croppedCandidateDiagnostics = visualAttempt.croppedCandidateDiagnostics;
    initialCroppedCandidateDiagnostics =
      visualAttempt.croppedCandidateDiagnostics;
    croppedFallback = visualAttempt.croppedFallback;

    if (!visualAttribution) {
      activeVisualStage = startContentFreeDiagnosticStage({
        metadata: {
          inputItemCount: initialReconstruction.recoveryFragments.length,
        },
        stage: "visual.recovery",
        trace,
      });
      const recoveryProposal = await inspectRecovery({
        fragments: initialReconstruction.recoveryFragments,
        screenshotUri,
        trace: visualTrace,
      });
      activeVisualStage.complete({
        outcome: recoveryProposal ? "proposal-created" : "no-proposal",
        reconstructedCount:
          recoveryProposal?.diagnostics.reconstructedCount ?? 0,
      });
      activeVisualStage = null;
      if (recoveryProposal) {
        recoveryDiagnostics = recoveryProposal.diagnostics;
      }
      const proposalChanged = Boolean(
        recoveryProposal &&
          (recoveryProposal.diagnostics.excludedFragmentIds.length > 0 ||
            recoveryProposal.diagnostics.mergePairs.length > 0 ||
            recoveryProposal.diagnostics.recoveredOcrLineIndexes.length > 0),
      );
      trace("visual.recovery.proposal", {
        inputFragmentCount: initialReconstruction.recoveryFragments.length,
        proposalAvailable: Boolean(recoveryProposal),
        proposalChanged,
        reconstructedCount:
          recoveryProposal?.diagnostics.reconstructedCount ?? 0,
        recoveredAttemptEligible: Boolean(
          recoveryProposal &&
            proposalChanged &&
            recoveryProposal.messages.length >= 2,
        ),
      });

      if (
        recoveryProposal &&
        proposalChanged &&
        recoveryProposal.messages.length >= 2
      ) {
        activeVisualStage = startContentFreeDiagnosticStage({
          metadata: { inputItemCount: recoveryProposal.messages.length },
          stage: "visual.recovered",
          trace,
        });
        const recoveredAttempt = await inspectAttribution({
          messages: recoveryProposal.messages,
          screenshotUri,
          stagePrefix: "recovered",
          trace: visualTrace,
        });
        activeVisualStage.complete({ outcome: recoveredAttempt.outcome });
        activeVisualStage = null;
        const recoveredCandidate = recoveredAttempt.croppedCandidateDiagnostics;
        recoveredCroppedCandidateDiagnostics = recoveredCandidate;
        recoveredVisualAttemptOutcome = recoveredAttempt.outcome;
        const recoveredObstruction = recoveredCandidate?.edgeCoverageDetected
          ? "edge-coverage"
          : recoveredCandidate?.composerOverlayDetected
            ? "composer-overlay"
            : null;
        const recoveryQualifies = shouldCommitVisualBubbleRecovery({
          chronologicallyLast: Boolean(
            recoveredCandidate?.candidateIsChronologicallyLast,
          ),
          lowerViewport: Boolean(recoveredCandidate?.lowerViewport),
          obstruction: recoveredObstruction,
          proposalChanged,
        });
        recoveryCommitDiagnostics =
          getVisualBubbleRecoveryCommitDiagnostics({
            chronologicallyLast: Boolean(
              recoveredCandidate?.candidateIsChronologicallyLast,
            ),
            lowerViewport: Boolean(recoveredCandidate?.lowerViewport),
            obstruction: recoveredObstruction,
            proposalChanged,
          });
        trace("visual.recovery.commit-decision", {
          ...recoveryCommitDiagnostics,
          recoveredCandidateEvidenceReady: Boolean(
            recoveredCandidate?.candidateEvidenceReady,
          ),
          recoveredVisualAttemptOutcome,
        });
        trace("visual.recovery.attempt-snapshots", {
          initialCandidate: initialCroppedCandidateDiagnostics ?? null,
          recoveredCandidate: recoveredCandidate ?? null,
          recoveryCommit: recoveryCommitDiagnostics,
        });

        if (recoveryQualifies) {
          recoveryDiagnostics = {
            ...recoveryProposal.diagnostics,
            committed: true,
          };
          attributionMessages = recoveryProposal.messages;
          visualAttribution = recoveredAttempt.attribution;
          visualDiagnostics = recoveredAttempt.attribution;
          visualEvidenceDiagnostics = recoveredAttempt.evidenceDiagnostics;
          visualContinuityDiagnostics = recoveredAttempt.continuityDiagnostics;
          croppedCandidateDiagnostics = recoveredCandidate;
          croppedFallback = recoveredAttempt.croppedFallback;
          visualAttemptOutcome = recoveredAttempt.attribution
            ? "recovery-accepted"
            : "recovery-incomplete";
          recoveryNeedsConfirmation = Boolean(
            !recoveredAttempt.attribution &&
              (!recoveredAttempt.croppedFallback ||
                recoveredAttempt.croppedFallback.kind === "needs-confirmation"),
          );
        }
      }
    }

    if (visualAttribution) {
      const visuallyMergedMessages = mergeVisuallyContinuousMessages(
        visualAttribution.messages,
        visualAttribution.continuousPairs,
      );
      const parsedConversation = buildParsedConversation(
        visuallyMergedMessages,
        {
          confidence: visualAttribution.confidence,
          meColumn: null,
          resolved: true,
        },
      );

      reconstruction = {
        ...reconstruction,
        confidence: parsedConversation.speakerAttributionConfidence,
        detectedMessages: visuallyMergedMessages,
        geometryAttributionAmbiguous: false,
        parsedConversation,
        transcriptText: formatTranscript(parsedConversation.structuredConversation),
      };
    } else if (recoveryNeedsConfirmation) {
      const messages = attributionMessages.map((message) => ({
        ...message,
        confidence: Math.min(message.confidence, 0.35),
        sender: "unknown" as const,
        speaker: "unknown" as const,
      }));
      const parsedConversation = buildParsedConversation(messages, {
        confidence: 0,
        meColumn: null,
        resolved: false,
      });

      reconstruction = {
        ...reconstruction,
        confidence: parsedConversation.speakerAttributionConfidence,
        detectedMessages: messages,
        geometryAttributionAmbiguous: true,
        parsedConversation,
        transcriptText: formatTranscript(parsedConversation.structuredConversation),
      };
    } else if (croppedFallback) {
      const activeCroppedFallback = croppedFallback;
      const recoveryPrototypeSpeakers = new Map(
        recoveryDiagnostics.committed
          ? activeCroppedFallback.prototypeSpeakers.map(({ id, sender }) => [id, sender])
          : [],
      );
      const messages = attributionMessages.map((message) => {
        if (message.id !== activeCroppedFallback.candidateId) {
          const prototypeSender = recoveryPrototypeSpeakers.get(message.id);
          if (prototypeSender) {
            return {
              ...message,
              confidence: Math.max(
                message.confidence,
                activeCroppedFallback.prototypeConfidence ?? 0.68,
              ),
              sender: prototypeSender,
              speaker: getSpeakerFromSender(prototypeSender),
            };
          }
          return message;
        }

        if (
          activeCroppedFallback.kind === "resolved" &&
          activeCroppedFallback.sender
        ) {
          return {
            ...message,
            confidence: Math.max(
              message.confidence,
              activeCroppedFallback.prototypeConfidence ?? 0.68,
            ),
            sender: activeCroppedFallback.sender,
            speaker: getSpeakerFromSender(activeCroppedFallback.sender),
          };
        }

        return {
          ...message,
          confidence: Math.min(message.confidence, 0.35),
          sender: "unknown" as const,
          speaker: "unknown" as const,
        };
      });
      const parsedConversation = buildParsedConversation(messages, {
        confidence: activeCroppedFallback.prototypeConfidence ?? 0,
        meColumn: null,
        resolved: activeCroppedFallback.kind === "resolved",
      });

      reconstruction = {
        ...reconstruction,
        confidence: parsedConversation.speakerAttributionConfidence,
        detectedMessages: messages,
        parsedConversation,
        transcriptText: formatTranscript(parsedConversation.structuredConversation),
      };
    }
  } catch (error) {
    // Visual attribution is optional. The established OCR-only parser remains
    // the safe fallback when a local image cannot be sampled.
    activeVisualStage?.fail({
      errorType: error instanceof Error ? error.name : "unknown",
    });
    activeVisualStage = null;
    visualAttemptOutcome = "sampling-failed";
    trace("visual.pipeline.failed", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }

  const finalAssemblyStage = startContentFreeDiagnosticStage({
    stage: "ocr.final-assembly",
    trace,
  });
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const finalMessagesById = new Map(
      reconstruction.detectedMessages.map((message) => [message.id, message]),
    );
    const visualById = new Map(
      visualDiagnostics?.diagnostics.map((item) => [item.id, item]) ?? [],
    );
    const finalGeometry =
      flattenedLines.length > 0 ? getLineGeometry(flattenedLines) : null;
    const finalGeometryWidth = Math.max(finalGeometry?.width ?? 1, 1);
    const finalGeometryHeight = Math.max(finalGeometry?.height ?? 1, 1);
    const finalGeometryLeft = finalGeometry?.minLeft ?? 0;
    const finalGeometryTop = finalGeometry?.minTop ?? 0;

    const attributionDiagnostics = {
      // Intentionally excludes OCR text, raw screenshots, names, and pixels.
      counts: {
        cleanedLines: initialReconstruction.diagnostics.cleanedLineCount,
        finalMessages: reconstruction.detectedMessages.length,
        groupedMessages: initialReconstruction.diagnostics.groupedMessageCount,
        rawBlocks: recognizedText.blocks.length,
        rawLines: initialReconstruction.diagnostics.rawLineCount,
        recoveryFragments: initialReconstruction.recoveryFragments.length,
        visualCandidates: recoveryDiagnostics.fragmentEvidence?.filter(
          (item) => item.evidenceReady,
        ).length ?? 0,
      },
      conversationGroups: initialReconstruction.diagnostics.geometryGroups.map(
        (group) => {
          const visual = visualById.get(group.id);
          const finalMessage = finalMessagesById.get(group.id);
          const visualOverrodeGeometry =
            Boolean(visual) && visual?.speaker !== group.geometrySpeaker;

          return {
            ...group,
            classification: "conversation",
            presentInFinalConversation: Boolean(finalMessage),
            finalConfidence: Number(
              (finalMessage?.confidence ?? group.confidence).toFixed(3),
            ),
            finalSpeaker: finalMessage?.sender ?? group.geometrySpeaker,
            finalReason: visual
              ? visualOverrodeGeometry
                ? "visual-high-confidence-override"
                : "visual-high-confidence-confirmed-geometry"
              : croppedFallback?.candidateId === group.id
                ? croppedFallback.kind === "resolved"
                  ? "cropped-prototype-override"
                  : "cropped-weak-evidence-confirmation"
                : "geometry-only",
            visualCluster: visual?.cluster ?? null,
            visualSpeaker: visual?.speaker ?? null,
          };
        },
      ),
      lineClassification: initialReconstruction.diagnostics.lines.sort(
        (first, second) => first.ocrIndex - second.ocrIndex,
      ),
      finalMessages: reconstruction.detectedMessages.map((message, index) => ({
        attributionSource: visualById.has(message.id)
          ? "visual"
          : croppedFallback?.candidateId === message.id
            ? croppedFallback.kind === "resolved"
              ? "cropped-prototype"
              : "manual-confirmation"
            : "geometry",
        confidence: Number(message.confidence.toFixed(3)),
        finalIndex: index,
        id: message.id,
        normalizedBottom: Number(
          (
            (message.boundingBox.y + message.boundingBox.height -
              finalGeometryTop) /
            finalGeometryHeight
          ).toFixed(3),
        ),
        normalizedLeft: Number(
          (
            (message.boundingBox.x - finalGeometryLeft) /
            finalGeometryWidth
          ).toFixed(3),
        ),
        normalizedRight: Number(
          (
            (message.boundingBox.x + message.boundingBox.width -
              finalGeometryLeft) /
            finalGeometryWidth
          ).toFixed(3),
        ),
        normalizedTop: Number(
          (
            (message.boundingBox.y - finalGeometryTop) /
            finalGeometryHeight
          ).toFixed(3),
        ),
        sender: message.sender,
      })),
      backendDecision: {
        backendEligible:
          reconstruction.parsedConversation.speakerAttributionResolved &&
          reconstruction.detectedMessages.length > 0,
        manualSpeakerConfirmationRequired:
          !reconstruction.parsedConversation.speakerAttributionResolved ||
          reconstruction.detectedMessages.length === 0,
      },
      visualAttemptOutcome,
      visualBubbleRecovery: recoveryDiagnostics,
      initialCroppedCandidate: initialCroppedCandidateDiagnostics,
      recoveredCroppedCandidate: recoveredCroppedCandidateDiagnostics,
      activeCroppedCandidate: croppedCandidateDiagnostics,
      recoveredVisualAttemptOutcome,
      recoveryCommit: recoveryCommitDiagnostics,
      croppedFallback,
      visualEvidence: visualEvidenceDiagnostics,
      visualContinuousPairs: visualDiagnostics?.continuousPairs ?? [],
      visualContinuity: visualContinuityDiagnostics,
    };

    console.info(
      "[Wingr native OCR attribution diagnostics]",
      JSON.stringify(attributionDiagnostics, null, 2),
    );
    trace("pipeline.summary", attributionDiagnostics);
    console.info("[Wingr native OCR] reconstruction ready", {
      detectedMessages: reconstruction.detectedMessages.length,
      latestMessageSender:
        reconstruction.parsedConversation.latestMessageSender,
      manualSpeakerConfirmationRequired:
        !reconstruction.parsedConversation.speakerAttributionResolved,
      runId: traceId,
      senderSequence: reconstruction.detectedMessages.map(
        (message) => message.sender,
      ),
      speakerAttributionConfidence:
        reconstruction.parsedConversation.speakerAttributionConfidence,
      speakerAttributionResolved:
        reconstruction.parsedConversation.speakerAttributionResolved,
    });
  }
  finalAssemblyStage.complete({
    detectedMessageCount: reconstruction.detectedMessages.length,
    speakerAttributionResolved:
      reconstruction.parsedConversation.speakerAttributionResolved,
  });

  if (!reconstruction.transcriptText.trim()) {
    trace("pipeline.failed", {
      durationMs: getDiagnosticDurationMs(pipelineStartedAt),
      failureStage: "empty-reconstruction",
    });
    throw new Error(
      "No readable conversation text was detected in that screenshot.",
    );
  }

  trace("pipeline.complete", {
    detectedMessageCount: reconstruction.detectedMessages.length,
    durationMs: getDiagnosticDurationMs(pipelineStartedAt),
    latestMessageSender:
      reconstruction.parsedConversation.latestMessageSender,
    manualSpeakerConfirmationRequired:
      !reconstruction.parsedConversation.speakerAttributionResolved,
    senderSequence: reconstruction.detectedMessages.map(
      (message) => message.sender,
    ),
  });

  return {
    ...reconstruction,
    rawText,
  };
}
