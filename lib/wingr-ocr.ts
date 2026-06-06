import type {
  Rect,
  Text as RecognizedText,
} from '@infinitered/react-native-mlkit-text-recognition';
import type {
  DetectedMessage,
  MessageSender,
  MessageSpeaker,
  MessageXPosition,
  OcrResult,
  ParsedConversation,
} from '../types/wingr';

type OcrLine = {
  id: string;
  text: string;
  frame: Rect;
};

type Bubble = {
  id: string;
  lines: OcrLine[];
  frame: Rect;
  sender: DetectedMessage['sender'];
  confidence: number;
};

type ConversationGeometry = {
  minLeft: number;
  maxRight: number;
  minTop: number;
  maxBottom: number;
  width: number;
  height: number;
};

const UI_LABELS = new Set([
  'back',
  'chat',
  'chats',
  'contact',
  'contacts',
  'delivered',
  'done',
  'edit',
  'imessage',
  'message',
  'messages',
  'now',
  'online',
  'profil',
  'profile',
  'read',
  'search',
  'send',
  'sent',
  'today',
  'typing',
  'yesterday',
]);

const SPEAKER_CONFIRMATION_THRESHOLD = 0.62;

function getWidth(frame: Rect) {
  return frame.right - frame.left;
}

function getHeight(frame: Rect) {
  return frame.bottom - frame.top;
}

function getCenterX(frame: Rect) {
  return frame.left + getWidth(frame) / 2;
}

function getBoundingBox(frame: Rect): DetectedMessage['boundingBox'] {
  return {
    height: getHeight(frame),
    width: getWidth(frame),
    x: frame.left,
    y: frame.top,
  };
}

function getXPosition(frame: Rect, geometry: Pick<ConversationGeometry, 'minLeft' | 'width'>): MessageXPosition {
  const centerX = getCenterX(frame);
  const pageMidpoint = geometry.minLeft + geometry.width / 2;
  const centerDeadZone = geometry.width * 0.12;

  if (centerX > pageMidpoint + centerDeadZone) {
    return 'right';
  }

  if (centerX < pageMidpoint - centerDeadZone) {
    return 'left';
  }

  return 'center';
}

function getSpeakerFromSender(sender: MessageSender): MessageSpeaker {
  if (sender === 'me') {
    return 'user';
  }

  if (sender === 'them') {
    return 'other';
  }

  return 'unknown';
}

function getFrameFromBoundingBox(boundingBox: DetectedMessage['boundingBox']): Rect {
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
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForLookup(text: string) {
  return normalizeText(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function getWordTokens(text: string) {
  return normalizeForLookup(text).split(' ').filter(Boolean);
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
    /^(mon|tue|wed|thu|fri|sat|sun),?\s+\d{1,2}[:.]\d{2}(\s?(am|pm))?$/.test(normalized)
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

function isDateDivider(text: string) {
  const normalized = normalizeForLookup(text);

  return (
    UI_LABELS.has(normalized) ||
    isDateLikeMetadata(text)
  );
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

function looksLikeHeaderName(text: string, frame: Rect, geometry: ConversationGeometry) {
  const normalized = normalizeText(text);
  const topRatio = (frame.top - geometry.minTop) / Math.max(geometry.height, 1);
  const widthRatio = getWidth(frame) / Math.max(geometry.width, 1);
  const centerDistance = Math.abs(getCenterX(frame) - (geometry.minLeft + geometry.width / 2));
  const nearCenter = centerDistance < geometry.width * 0.25;
  const words = normalized.split(' ');
  const isShortTitle = words.length <= 4 && normalized.length <= 34;
  const hasSentenceShape = /[?.!,:;]$/.test(normalized) || normalized.length > 34;

  return topRatio < 0.18 && nearCenter && widthRatio < 0.55 && isShortTitle && !hasSentenceShape;
}

function isObviousUiLine(line: OcrLine, geometry: ConversationGeometry) {
  const text = line.text;

  if (!text || text.length <= 1) {
    return true;
  }

  if (isStandaloneTimestamp(text) || isStatusBarNoise(text) || isDateDivider(text)) {
    return true;
  }

  if (/^[<›‹ chevron]+$/i.test(text)) {
    return true;
  }

  return looksLikeHeaderName(text, line.frame, geometry);
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

function cleanOcrLines(lines: OcrLine[]) {
  if (lines.length === 0) {
    return [];
  }

  const geometry = getLineGeometry(lines);
  const filteredLines = lines.filter((line) => {
    if (isObviousUiLine(line, geometry)) {
      return false;
    }

    const bottomRatio = (line.frame.bottom - geometry.minTop) / Math.max(geometry.height, 1);

    return bottomRatio < 0.94 || looksLikeConversationText(line.text);
  });

  return stripTopChrome(filteredLines);
}

function looksLikeConversationText(text: string) {
  const normalized = normalizeText(text);
  const words = normalized.split(' ').filter(Boolean);

  return normalized.length >= 18 || words.length >= 4 || /[?.!,]$/.test(normalized);
}

function stripTopChrome(lines: OcrLine[]) {
  const firstConversationIndex = lines.findIndex((line) => looksLikeConversationText(line.text));

  if (firstConversationIndex <= 0) {
    return lines;
  }

  return lines.filter((line, index) => {
    if (index >= firstConversationIndex) {
      return true;
    }

    const normalized = normalizeText(line.text);
    const words = normalized.split(' ').filter(Boolean);
    const hasMessagePunctuation = /[?.!,]$/.test(normalized);

    return normalized.length > 22 || words.length > 3 || hasMessagePunctuation;
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

function verticalGap(previous: OcrLine, next: OcrLine) {
  return next.frame.top - previous.frame.bottom;
}

function overlapRatio(previous: OcrLine, next: OcrLine) {
  const overlap = Math.min(previous.frame.right, next.frame.right) - Math.max(previous.frame.left, next.frame.left);
  const smallerWidth = Math.min(getWidth(previous.frame), getWidth(next.frame));

  return Math.max(overlap, 0) / Math.max(smallerWidth, 1);
}

function lineAlignmentScore(previous: OcrLine, next: OcrLine, geometry: ConversationGeometry) {
  const leftDelta = Math.abs(previous.frame.left - next.frame.left);
  const rightDelta = Math.abs(previous.frame.right - next.frame.right);
  const centerDelta = Math.abs(getCenterX(previous.frame) - getCenterX(next.frame));
  const alignedEdge = Math.min(leftDelta, rightDelta);

  if (alignedEdge <= geometry.width * 0.08 || overlapRatio(previous, next) > 0.35) {
    return 1;
  }

  if (centerDelta <= geometry.width * 0.18) {
    return 0.6;
  }

  return 0;
}

function shouldMergeIntoBubble(previous: OcrLine, next: OcrLine, geometry: ConversationGeometry) {
  const gap = verticalGap(previous, next);
  const lineHeight = Math.max(getHeight(previous.frame), getHeight(next.frame), 12);

  if (gap < -lineHeight * 0.45 || gap > lineHeight * 1.45) {
    return false;
  }

  return lineAlignmentScore(previous, next, geometry) > 0;
}

function inferSender(frame: Rect, geometry: ConversationGeometry) {
  const centerX = getCenterX(frame);
  const pageMidpoint = geometry.minLeft + geometry.width / 2;
  const edgeInset = geometry.width * 0.16;
  const centerDeadZone = geometry.width * 0.12;
  let rightScore = 0;
  let leftScore = 0;

  if (frame.right > geometry.maxRight - edgeInset) {
    rightScore += 0.45;
  }

  if (frame.left < geometry.minLeft + edgeInset) {
    leftScore += 0.45;
  }

  if (centerX > pageMidpoint + centerDeadZone) {
    rightScore += 0.45;
  }

  if (centerX < pageMidpoint - centerDeadZone) {
    leftScore += 0.45;
  }

  if (frame.left > pageMidpoint) {
    rightScore += 0.2;
  }

  if (frame.right < pageMidpoint) {
    leftScore += 0.2;
  }

  const delta = Math.abs(rightScore - leftScore);

  if (delta < 0.25) {
    return { confidence: 0.35, sender: 'unknown' as const };
  }

  const confidence = Math.min(0.95, 0.45 + delta);

  return {
    confidence,
    sender: rightScore > leftScore ? ('me' as const) : ('them' as const),
  };
}

function parseBubbles(lines: OcrLine[]) {
  if (lines.length === 0) {
    return [];
  }

  const geometry = getLineGeometry(lines);
  const groupedLines = lines.reduce<OcrLine[][]>((groups, line) => {
    const previousGroup = groups[groups.length - 1];
    const previousLine = previousGroup?.[previousGroup.length - 1];

    if (previousLine && shouldMergeIntoBubble(previousLine, line, geometry)) {
      previousGroup.push(line);
    } else {
      groups.push([line]);
    }

    return groups;
  }, []);

  const bubbles = groupedLines.map((group, index): Bubble => {
    const frame = unionFrame(group);
    const { confidence, sender } = inferSender(frame, geometry);

    return {
      confidence,
      frame,
      id: `bubble-${index + 1}`,
      lines: group,
      sender,
    };
  });

  const metadataFilteredBubbles = filterMetadataBubbles(bubbles, geometry);
  const clusteredBubbles = applyClusterSenderInference(metadataFilteredBubbles, geometry);

  return applyKnownSenderAlignmentInference(clusteredBubbles, geometry);
}

function bubbleText(bubble: Bubble) {
  return bubble.lines.map((line) => line.text).join(' ').replace(/\s+([?.!,])/g, '$1');
}

function isLowContentMetadataText(text: string) {
  const normalized = normalizeText(text);
  const tokens = getWordTokens(normalized);

  return (
    normalized.length <= 18 &&
    tokens.length <= 3 &&
    !/[?!]$/.test(normalized) &&
    !/\p{Extended_Pictographic}/u.test(normalized) &&
    !isStandaloneTimestamp(normalized)
  );
}

function looksLikeReceiptBubble(bubble: Bubble, previousBubble: Bubble | undefined, geometry: ConversationGeometry) {
  if (!previousBubble || !isLowContentMetadataText(bubbleText(bubble))) {
    return false;
  }

  const gap = bubble.frame.top - previousBubble.frame.bottom;
  const closeToPrevious = gap >= -6 && gap <= Math.max(getHeight(previousBubble.frame) * 0.75, 42);
  const narrow = getWidth(bubble.frame) <= geometry.width * 0.42;
  const shorterThanMessage = getHeight(bubble.frame) <= Math.max(getHeight(previousBubble.frame) * 0.72, 18);
  const nearPreviousSide =
    Math.abs(getCenterX(bubble.frame) - getCenterX(previousBubble.frame)) <= geometry.width * 0.42 ||
    Math.abs(bubble.frame.right - previousBubble.frame.right) <= geometry.width * 0.2;

  return closeToPrevious && narrow && shorterThanMessage && nearPreviousSide;
}

function looksLikeCenteredSeparatorBubble(bubble: Bubble, geometry: ConversationGeometry) {
  const text = bubbleText(bubble);
  const pageMidpoint = geometry.minLeft + geometry.width / 2;
  const centerDistance = Math.abs(getCenterX(bubble.frame) - pageMidpoint);

  return (
    isLowContentMetadataText(text) &&
    centerDistance <= geometry.width * 0.18 &&
    getWidth(bubble.frame) <= geometry.width * 0.5
  );
}

function filterMetadataBubbles(bubbles: Bubble[], geometry: ConversationGeometry) {
  const keptBubbles: Bubble[] = [];
  const outgoingAnchorFrames: Rect[] = [];

  bubbles.forEach((bubble) => {
    const text = bubbleText(bubble);
    const previousBubble = keptBubbles[keptBubbles.length - 1];

    if (isDateLikeMetadata(text) || isStandaloneTimestamp(text)) {
      return;
    }

    if (looksLikeCenteredSeparatorBubble(bubble, geometry)) {
      return;
    }

    if (looksLikeReceiptBubble(bubble, previousBubble, geometry)) {
      if (previousBubble) {
        previousBubble.sender = 'me';
        previousBubble.confidence = Math.max(previousBubble.confidence, 0.88);
        outgoingAnchorFrames.push(previousBubble.frame);
      }

      return;
    }

    keptBubbles.push(bubble);
  });

  return applyOutgoingAnchorInference(keptBubbles, outgoingAnchorFrames, geometry);
}

function applyOutgoingAnchorInference(
  bubbles: Bubble[],
  outgoingAnchorFrames: Rect[],
  geometry: ConversationGeometry,
) {
  if (outgoingAnchorFrames.length === 0) {
    return bubbles;
  }

  return bubbles.map((bubble) => {
    const pageMidpoint = geometry.minLeft + geometry.width / 2;
    const matchesOutgoingAnchor = outgoingAnchorFrames.some((anchorFrame) => {
      const rightDelta = Math.abs(bubble.frame.right - anchorFrame.right);
      const centerDelta = Math.abs(getCenterX(bubble.frame) - getCenterX(anchorFrame));
      const leftOfAnchorByMuch = bubble.frame.left < anchorFrame.left - geometry.width * 0.06;
      const clearlyRightSide = getCenterX(bubble.frame) > pageMidpoint + geometry.width * 0.025;
      const confidentlyIncoming = bubble.sender === 'them' && bubble.confidence >= 0.55;
      const verticalDistance = Math.abs(bubble.frame.top - anchorFrame.top);
      const nearSameMessageCluster =
        verticalDistance <= Math.max(getHeight(anchorFrame) * 1.25, geometry.height * 0.16);

      if (confidentlyIncoming) {
        return false;
      }

      return (
        rightDelta <= geometry.width * 0.14 &&
        centerDelta <= geometry.width * 0.18 &&
        !leftOfAnchorByMuch &&
        clearlyRightSide &&
        nearSameMessageCluster
      );
    });

    if (!matchesOutgoingAnchor) {
      return bubble;
    }

    return {
      ...bubble,
        confidence: Math.max(bubble.confidence, 0.82),
      sender: 'me' as const,
    };
  });
}

function applyClusterSenderInference(bubbles: Bubble[], geometry: ConversationGeometry) {
  const conversationalBubbles = bubbles.filter((bubble) => bubbleText(bubble).length >= 6);

  if (conversationalBubbles.length < 2) {
    return bubbles;
  }

  const centers = conversationalBubbles.map((bubble) => getCenterX(bubble.frame)).sort((a, b) => a - b);
  const leftMost = centers[0];
  const rightMost = centers[centers.length - 1];
  const spread = rightMost - leftMost;

  if (spread < geometry.width * 0.14) {
    return bubbles;
  }

  const split = leftMost + spread / 2;
  const margin = Math.max(geometry.width * 0.025, 8);

  return bubbles.map((bubble) => {
    const centerX = getCenterX(bubble.frame);
    const distanceFromSplit = Math.abs(centerX - split);

    if (bubble.sender !== 'unknown' && bubble.confidence >= 0.8) {
      return bubble;
    }

    if (distanceFromSplit < margin) {
      return bubble;
    }

    const clusterSender: DetectedMessage['sender'] = centerX > split ? 'me' : 'them';
    const clusterConfidence = Math.min(0.9, 0.58 + distanceFromSplit / Math.max(spread, 1) * 0.5);

    if (bubble.sender === 'unknown' || bubble.confidence < clusterConfidence) {
      return {
        ...bubble,
        confidence: clusterConfidence,
        sender: clusterSender,
      };
    }

    return bubble;
  });
}

function getAlignmentDeltas(frame: Rect, knownFrames: Rect[], geometry: ConversationGeometry) {
  if (knownFrames.length === 0) {
    return null;
  }

  const left = Math.min(...knownFrames.map((knownFrame) => Math.abs(frame.left - knownFrame.left))) / geometry.width;
  const right = Math.min(...knownFrames.map((knownFrame) => Math.abs(frame.right - knownFrame.right))) / geometry.width;
  const center =
    Math.min(...knownFrames.map((knownFrame) => Math.abs(getCenterX(frame) - getCenterX(knownFrame)))) /
    geometry.width;
  const score = Math.min(
    ...knownFrames.map((knownFrame) => {
      const leftDelta = Math.abs(frame.left - knownFrame.left) / geometry.width;
      const rightDelta = Math.abs(frame.right - knownFrame.right) / geometry.width;
      const centerDelta = Math.abs(getCenterX(frame) - getCenterX(knownFrame)) / geometry.width;

      return leftDelta * 0.9 + rightDelta * 0.8 + centerDelta;
    }),
  );

  return { center, left, right, score };
}

function countCloserAlignmentVotes(
  candidate: ReturnType<typeof getAlignmentDeltas>,
  other: ReturnType<typeof getAlignmentDeltas>,
) {
  if (!candidate) {
    return 0;
  }

  if (!other) {
    return 3;
  }

  const margin = 0.015;

  return [
    candidate.left + margin < other.left,
    candidate.right + margin < other.right,
    candidate.center + margin < other.center,
  ].filter(Boolean).length;
}

function chooseSenderFromKnownAlignment(bubble: Bubble, bubbles: Bubble[], geometry: ConversationGeometry) {
  const knownYouFrames = bubbles
    .filter((candidate) => candidate.sender === 'me' && candidate.confidence >= 0.72)
    .map((candidate) => candidate.frame);
  const knownThemFrames = bubbles
    .filter((candidate) => candidate.sender === 'them' && candidate.confidence >= 0.55)
    .map((candidate) => candidate.frame);
  const youDeltas = getAlignmentDeltas(bubble.frame, knownYouFrames, geometry);
  const themDeltas = getAlignmentDeltas(bubble.frame, knownThemFrames, geometry);
  const youVotes = countCloserAlignmentVotes(youDeltas, themDeltas);
  const themVotes = countCloserAlignmentVotes(themDeltas, youDeltas);

  if (
    youDeltas &&
    youDeltas.score <= 0.16 &&
    youVotes >= 2 &&
    (!themDeltas || youDeltas.score <= themDeltas.score + 0.02)
  ) {
    return 'me' as const;
  }

  if (
    themDeltas &&
    themDeltas.score <= 0.16 &&
    themVotes >= 2 &&
    (!youDeltas || themDeltas.score <= youDeltas.score + 0.02)
  ) {
    return 'them' as const;
  }

  return null;
}

function applyKnownSenderAlignmentInference(bubbles: Bubble[], geometry: ConversationGeometry) {
  return bubbles.map((bubble) => {
    if (bubble.sender !== 'unknown' || bubble.confidence >= 0.55) {
      return bubble;
    }

    const sender = chooseSenderFromKnownAlignment(bubble, bubbles, geometry);

    if (!sender) {
      return bubble;
    }

    return {
      ...bubble,
      confidence: Math.max(bubble.confidence, 0.72),
      sender,
    };
  });
}

function parseMessages(lines: OcrLine[]): DetectedMessage[] {
  const bubbles = parseBubbles(lines);
  const geometry = bubbles.length > 0 ? getLineGeometry(bubbles.flatMap((bubble) => bubble.lines)) : null;

  return bubbles
    .map((bubble, index) => {
      const sender = bubble.confidence >= 0.55 ? bubble.sender : ('unknown' as const);

      return {
        boundingBox: getBoundingBox(bubble.frame),
        confidence: bubble.confidence,
        id: `message-${index + 1}`,
        sender,
        speaker: getSpeakerFromSender(sender),
        text: bubbleText(bubble),
        xPosition: geometry ? getXPosition(bubble.frame, geometry) : 'center',
      };
    })
    .filter((message) => message.text.length > 1);
}

function formatTranscript(messages: DetectedMessage[]) {
  return messages
    .map((message) => {
      const senderLabel =
        message.sender === 'me' ? 'ME' : message.sender === 'them' ? 'THEM' : 'UNKNOWN';

      return `${senderLabel}: ${message.text}`;
    })
    .join('\n');
}

function getLatestMessageSender(messages: DetectedMessage[]): MessageSender {
  return messages[messages.length - 1]?.sender ?? 'unknown';
}

function getSpeakerAttributionConfidence(messages: DetectedMessage[]) {
  if (messages.length === 0) {
    return 0;
  }

  const averageConfidence =
    messages.reduce((total, message) => total + message.confidence, 0) / messages.length;
  const unknownPenalty = messages.filter((message) => message.sender === 'unknown').length / messages.length * 0.35;
  const latestMessage = messages[messages.length - 1];
  const latestPenalty = latestMessage.sender === 'unknown' ? 0.2 : Math.max(0, 0.62 - latestMessage.confidence) * 0.35;

  return Math.max(0, Math.min(1, averageConfidence - unknownPenalty - latestPenalty));
}

export function buildParsedConversation(messages: DetectedMessage[]): ParsedConversation {
  const latestMessageSender = getLatestMessageSender(messages);

  return {
    latestMessageSender,
    messages,
    shouldGenerateDirectReply: latestMessageSender === 'them',
    speakerAttributionConfidence: getSpeakerAttributionConfidence(messages),
  };
}

export function needsSpeakerConfirmation(parsedConversation: ParsedConversation) {
  const confidentMeMessages = parsedConversation.messages.filter(
    (message) => message.sender === 'me' && message.confidence >= 0.62,
  ).length;
  const confidentThemMessages = parsedConversation.messages.filter(
    (message) => message.sender === 'them' && message.confidence >= 0.62,
  ).length;

  return (
    parsedConversation.speakerAttributionConfidence < SPEAKER_CONFIRMATION_THRESHOLD ||
    parsedConversation.latestMessageSender === 'unknown' ||
    (parsedConversation.speakerAttributionConfidence < 0.8 &&
      (confidentMeMessages === 0 || confidentThemMessages === 0))
  );
}

function getMessageGeometry(messages: DetectedMessage[]) {
  const frames = messages.map((message) => getFrameFromBoundingBox(message.boundingBox));

  return {
    maxRight: Math.max(...frames.map((frame) => frame.right)),
    minLeft: Math.min(...frames.map((frame) => frame.left)),
  };
}

export function rebuildOcrResultWithConfirmedUserSide(
  ocr: OcrResult,
  userSide: 'left' | 'right',
): OcrResult {
  if (ocr.detectedMessages.length === 0) {
    return ocr;
  }

  const geometry = getMessageGeometry(ocr.detectedMessages);
  const midpoint = geometry.minLeft + (geometry.maxRight - geometry.minLeft) / 2;
  const messages = ocr.detectedMessages.map((message): DetectedMessage => {
    const frame = getFrameFromBoundingBox(message.boundingBox);
    const side = getCenterX(frame) >= midpoint ? 'right' : 'left';
    const sender: MessageSender = side === userSide ? 'me' : 'them';
    const midpointDistance = Math.abs(getCenterX(frame) - midpoint) / Math.max(geometry.maxRight - geometry.minLeft, 1);
    const confidence = Math.max(message.confidence, midpointDistance < 0.05 ? 0.72 : 0.9);

    return {
      ...message,
      confidence,
      sender,
      speaker: getSpeakerFromSender(sender),
      xPosition: side,
    };
  });
  const parsedConversation = buildParsedConversation(messages);
  const transcriptText = formatTranscript(messages);

  return {
    ...ocr,
    confidence: parsedConversation.speakerAttributionConfidence,
    detectedMessages: messages,
    parsedConversation,
    transcriptText,
  };
}

export async function extractChatTextFromImage(screenshotUri: string): Promise<OcrResult> {
  if (!screenshotUri) {
    throw new Error('No screenshot selected.');
  }

  let recognizedText: RecognizedText;

  try {
    const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
    recognizedText = await recognizeText(screenshotUri);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown OCR error.';
    throw new Error(
      `On-device OCR failed. Make sure you are using an Expo Development Build with Google ML Kit installed. ${detail}`,
    );
  }

  const rawText = recognizedText.text?.trim() ?? '';
  const cleanedLines = cleanOcrLines(flattenLines(recognizedText));
  const detectedMessages = parseMessages(cleanedLines);
  const parsedConversation = buildParsedConversation(detectedMessages);
  const transcriptText = formatTranscript(detectedMessages);

  if (!transcriptText.trim()) {
    throw new Error('No readable conversation text was detected in that screenshot.');
  }

  return {
    confidence: parsedConversation.speakerAttributionConfidence,
    detectedMessages,
    parsedConversation,
    rawText,
    source: 'onDevice',
    transcriptText,
  };
}
