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
import { inspectVisualBubbleAttribution } from "./visual-bubble-attribution";

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
  normalizedWidth: number;
};

type ReconstructionAttributionDiagnostics = {
  geometryGroups: GeometryAttributionDiagnostic[];
  lines: OcrLineAttributionDiagnostic[];
};

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

function reconstructConversationFromOcrLinesWithDiagnostics(
  lineInputs: OcrLineInput[],
): { diagnostics: ReconstructionAttributionDiagnostics; result: OcrResult } {
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
  const lineDiagnostics: OcrLineAttributionDiagnostic[] = [];
  const cleanedLines = cleanOcrLines(rawLines, lineDiagnostics);
  const {
    geometryAmbiguous,
    groupLineIndexes,
    mapping,
    messages: detectedMessages,
  } = parseMessages(
    cleanedLines,
    rawLines,
  );
  const parsedConversation = buildParsedConversation(detectedMessages, mapping);
  const conversationGeometry =
    cleanedLines.length > 0 ? getLineGeometry(cleanedLines) : null;
  const geometryGroups: GeometryAttributionDiagnostic[] = detectedMessages.map(
    (message, index) => {
      const frame = getFrameFromBoundingBox(message.boundingBox);
      const width = Math.max(conversationGeometry?.width ?? 1, 1);
      const left = conversationGeometry?.minLeft ?? 0;

      return {
        confidence: Number(message.confidence.toFixed(3)),
        geometrySpeaker: message.sender,
        groupIndex: index + 1,
        id: message.id,
        ocrLineIndexes: groupLineIndexes[message.id] ?? [],
        normalizedCenterX: Number(((getCenterX(frame) - left) / width).toFixed(3)),
        normalizedLeft: Number(((frame.left - left) / width).toFixed(3)),
        normalizedRight: Number(((frame.right - left) / width).toFixed(3)),
        normalizedWidth: Number((getWidth(frame) / width).toFixed(3)),
      };
    },
  );

  return {
    diagnostics: { geometryGroups, lines: lineDiagnostics },
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
): Promise<OcrResult> {
  if (!screenshotUri) {
    throw new Error("No screenshot selected.");
  }

  let recognizedText: RecognizedText;
  let nativeOcrStage = "module-import";

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[Wingr native OCR] started", {
      uriScheme: screenshotUri.match(/^([^:]+):/)?.[1] ?? "path",
    });
  }

  try {
    const { recognizeText } =
      await import("@infinitered/react-native-mlkit-text-recognition");

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] module ready");
    }

    nativeOcrStage = "recognition";
    recognizedText = await recognizeText(screenshotUri);

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] recognition ready", {
        blocks: recognizedText.blocks.length,
        lines: recognizedText.blocks.reduce(
          (total, block) => total + block.lines.length,
          0,
        ),
      });
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown OCR error.";

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr native OCR] failed", {
        message: detail,
        stage: nativeOcrStage,
      });
    }

    throw new Error(
      `On-device OCR failed. Make sure you are using an Expo Development Build with Google ML Kit installed. ${detail}`,
    );
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.info("[Wingr native OCR] reconstructing");
  }

  const initialReconstruction = reconstructConversationFromOcrLinesWithDiagnostics(
    flattenLines(recognizedText),
  );
  let reconstruction = initialReconstruction.result;
  const rawText = recognizedText.text?.trim() ?? reconstruction.rawText;
  let visualDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["attribution"]
    | null = null;
  let visualEvidenceDiagnostics:
    | Awaited<ReturnType<typeof inspectVisualBubbleAttribution>>["evidenceDiagnostics"] =
    [];
  let visualAttemptOutcome = "not-attempted";

  try {
    // OCR text geometry alone is not a reliable speaker signal for layouts
    // whose incoming and outgoing text starts at similar positions. A visual
    // result only replaces geometry when it independently clears the visual
    // module's confidence threshold; otherwise the established geometry result
    // remains untouched.
    const visualAttempt =
      reconstruction.detectedMessages.length >= 2
        ? await inspectVisualBubbleAttribution({
            messages: reconstruction.detectedMessages,
            screenshotUri,
          })
        : {
            attribution: null,
            evidenceDiagnostics: [],
            outcome: "insufficient-messages" as const,
          };
    const visualAttribution = visualAttempt.attribution;

    visualAttemptOutcome = visualAttempt.outcome;
    visualDiagnostics = visualAttribution;
    visualEvidenceDiagnostics = visualAttempt.evidenceDiagnostics;

    if (visualAttribution) {
      const parsedConversation = buildParsedConversation(
        visualAttribution.messages,
        {
          confidence: visualAttribution.confidence,
          meColumn: null,
          resolved: true,
        },
      );

      reconstruction = {
        ...reconstruction,
        confidence: parsedConversation.speakerAttributionConfidence,
        detectedMessages: visualAttribution.messages,
        geometryAttributionAmbiguous: false,
        parsedConversation,
        transcriptText: formatTranscript(parsedConversation.structuredConversation),
      };
    }
  } catch {
    // Visual attribution is optional. The established OCR-only parser remains
    // the safe fallback when a local image cannot be sampled.
    visualAttemptOutcome = "sampling-failed";
  }

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    const finalMessagesById = new Map(
      reconstruction.detectedMessages.map((message) => [message.id, message]),
    );
    const visualById = new Map(
      visualDiagnostics?.diagnostics.map((item) => [item.id, item]) ?? [],
    );

    console.info("[Wingr native OCR attribution diagnostics]", {
      // Intentionally excludes OCR text, raw screenshots, names, and pixels.
      conversationGroups: initialReconstruction.diagnostics.geometryGroups.map(
        (group) => {
          const visual = visualById.get(group.id);
          const finalMessage = finalMessagesById.get(group.id);
          const visualOverrodeGeometry =
            Boolean(visual) && visual?.speaker !== group.geometrySpeaker;

          return {
            ...group,
            classification: "conversation",
            finalConfidence: Number(
              (finalMessage?.confidence ?? group.confidence).toFixed(3),
            ),
            finalSpeaker: finalMessage?.sender ?? group.geometrySpeaker,
            finalReason: visual
              ? visualOverrodeGeometry
                ? "visual-high-confidence-override"
                : "visual-high-confidence-confirmed-geometry"
              : "geometry-only",
            visualCluster: visual?.cluster ?? null,
            visualSpeaker: visual?.speaker ?? null,
          };
        },
      ),
      lineClassification: initialReconstruction.diagnostics.lines.sort(
        (first, second) => first.ocrIndex - second.ocrIndex,
      ),
      visualAttemptOutcome,
      visualEvidence: visualEvidenceDiagnostics,
    });
    console.info("[Wingr native OCR] reconstruction ready", {
      detectedMessages: reconstruction.detectedMessages.length,
      speakerAttributionConfidence:
        reconstruction.parsedConversation.speakerAttributionConfidence,
      speakerAttributionResolved:
        reconstruction.parsedConversation.speakerAttributionResolved,
    });
  }

  if (!reconstruction.transcriptText.trim()) {
    throw new Error(
      "No readable conversation text was detected in that screenshot.",
    );
  }

  return {
    ...reconstruction,
    rawText,
  };
}
