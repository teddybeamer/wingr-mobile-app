import assert from "node:assert/strict";
import test from "node:test";
import {
  buildParsedConversation,
  extractChatTextFromImage,
  mergeVisuallyContinuousMessages,
  needsSpeakerConfirmation,
  reconstructConversationFromOcrLines,
  reconstructVisualRecoveryFragmentsFromOcrLines,
  type OcrLineInput,
} from "./wingr-ocr";
import {
  getCroppedBottomObstruction,
  isVisuallyContinuousBridge,
  reconstructVisualBubblesFromSamples,
  resolveCroppedBottomBubbleFromEvidence,
  resolveVisualBubbleAttributionFromEvidence,
  shouldCommitVisualBubbleRecovery,
  type VisualBubbleRecoveryFragment,
  type VisualBubbleAttributionAttempt,
  type VisualBubbleEvidence,
} from "./visual-bubble-attribution";
import type { DetectedMessage } from "../types/wingr";
import type { ImageColorSample } from "../modules/visual-bubble-attribution/src";
import { isContentFreeDiagnosticPayload } from "./content-free-diagnostics";
import type { Text as RecognizedText } from "@infinitered/react-native-mlkit-text-recognition";

function line(
  text: string,
  left: number,
  top: number,
  right: number,
  bottom = top + 18,
  recognizedLanguages?: string[],
): OcrLineInput {
  return {
    frame: { bottom, left, right, top },
    recognizedLanguages,
    text,
  };
}

test("allows numeric OCR diagnostics while rejecting content-bearing fields", () => {
  assert.equal(
    isContentFreeDiagnosticPayload({
      bounds: { normalizedBottom: 0.91, normalizedTop: 0.78 },
      confidence: 0.82,
      ocrLineIndexes: [19, 20, 21, 22, 23],
      runId: "ocr-1",
      sender: "me",
      stage: "speaker-attribution.complete",
    }),
    true,
  );
  assert.equal(
    isContentFreeDiagnosticPayload({ nested: { transcriptText: "private" } }),
    false,
  );
  assert.equal(
    isContentFreeDiagnosticPayload({ samples: [{ red: 50 }] }),
    false,
  );
  assert.equal(
    isContentFreeDiagnosticPayload({ screenshotUri: "file:///private/image.png" }),
    false,
  );
});

test("merges a wrapped message without merging the next bubble", () => {
  const result = reconstructConversationFromOcrLines([
    line("I had a really good time", 24, 100, 190),
    line("with you yesterday.", 24, 122, 165),
    line("Me too, let us do it again.", 236, 166, 350),
    line("Delivered", 296, 190, 350, 204),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "I had a really good time with you yesterday." },
    { speaker: "me", text: "Me too, let us do it again." },
  ]);
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);
});

test("keeps very short replies in their established columns", () => {
  const result = reconstructConversationFromOcrLines([
    line("ok", 24, 100, 46),
    line("yeah", 282, 142, 326),
    line("lol", 296, 176, 326),
    line("Read", 292, 200, 326, 214),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "ok" },
    { speaker: "me", text: "yeah" },
    { speaker: "me", text: "lol" },
  ]);
});

test("keeps consecutive same-side messages separate and consistently attributed", () => {
  const result = reconstructConversationFromOcrLines([
    line("How was your meeting?", 20, 100, 158),
    line("It went well.", 238, 140, 332),
    line("I will tell you more later.", 228, 174, 350),
    line("Delivered", 296, 198, 350, 212),
    line("Looking forward to it.", 22, 236, 168),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.speaker,
    ),
    ["them", "me", "me", "them"],
  );
  assert.equal(result.detectedMessages.length, 4);
});

test("learns columns from a cropped screenshot instead of absolute screen position", () => {
  const result = reconstructConversationFromOcrLines([
    line("Are you still around?", 422, 100, 554),
    line("Yes, I am on my way.", 640, 140, 780),
    line("Perfect.", 438, 180, 500),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "Are you still around?" },
    { speaker: "me", text: "Yes, I am on my way." },
    { speaker: "them", text: "Perfect." },
  ]);
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);
  assert.equal(result.geometryAttributionAmbiguous, false);
});

test("keeps the supplied cropped-bottom Danish outgoing message as ME", () => {
  const result = reconstructConversationFromOcrLines([
    line("Hey Lang tid siden - how goes?", 252, 120, 350),
    line("Delivered", 296, 146, 350, 160),
    line("Hey! Ja det er så :) stille og roligt, nyder søndagen med en lille gåtur. Hvad med dig?", 22, 210, 200),
    line("Lyder da fedt Her står den bare på arbejde. Har en app idé jeg går og nørkler med... Men burde tage en pause her snart haha", 236, 300, 350),
    line("Spændende, hvad er det for en app? :) altid vigtigt med pauser ;)", 22, 430, 210),
    line("Det er en ai dating coach haha. Vil lige teste om der er et marked eller ikke. Vi burde da få gået anden tur snart", 236, 520, 350),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map((message) => message.speaker),
    ["me", "them", "me", "them", "me"],
  );
  assert.equal(result.parsedConversation.latestMessageSender, "me");
  assert.equal(result.parsedConversation.shouldGenerateDirectReply, false);
  assert.equal(
    result.parsedConversation.structuredConversation.at(-2)?.text,
    "Spændende, hvad er det for en app? :) altid vigtigt med pauser ;)",
  );
});

test("uses confirmation only when a sparse screenshot has no resolved column mapping", () => {
  const result = reconstructConversationFromOcrLines([
    line("Still thinking about that dinner", 250, 100, 440),
  ]);

  assert.equal(result.parsedConversation.speakerAttributionResolved, false);
  assert.equal(result.detectedMessages[0]?.sender, "unknown");
  assert.equal(needsSpeakerConfirmation(result.parsedConversation), true);
});

test("removes timestamps and receipts while using the receipt as an outgoing anchor", () => {
  const result = reconstructConversationFromOcrLines([
    line("12:34", 170, 72, 210),
    line("Want to get coffee?", 24, 108, 150),
    line("Absolutely.", 276, 148, 350),
    line("Delivered", 296, 172, 350, 186),
  ]);

  assert.deepEqual(result.parsedConversation.structuredConversation, [
    { speaker: "them", text: "Want to get coffee?" },
    { speaker: "me", text: "Absolutely." },
  ]);
  assert.equal(result.transcriptText.includes("12:34"), false);
  assert.equal(result.transcriptText.includes("Delivered"), false);
});

test("does not turn a punctuation-only header control into a chat message", () => {
  const result = reconstructConversationFromOcrLines([
    line("...", 314, 36, 346),
    line("Hey", 252, 110, 300),
    line("How is your week going?", 22, 174, 186),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.text,
    ),
    ["Hey", "How is your week going?"],
  );
});

test("removes a compact top-right header control even when OCR reads it as words", () => {
  const result = reconstructConversationFromOcrLines([
    line("menu item", 310, 36, 350),
    line("Hey", 252, 110, 300),
    line("How is your week going?", 22, 174, 186),
  ]);

  assert.deepEqual(
    result.parsedConversation.structuredConversation.map(
      (message) => message.text,
    ),
    ["Hey", "How is your week going?"],
  );
});

test("merges only visually continuous wrapped groups, not separate same-speaker bubbles", () => {
  const messages: DetectedMessage[] = [
    {
      ...visualMessage("norway-first", 292, 560),
      sender: "me",
      speaker: "user",
      text: "First part",
    },
    {
      ...visualMessage("norway-last", 292, 480),
      sender: "me",
      speaker: "user",
      text: "Continuation",
    },
    {
      ...visualMessage("roommate", 160, 620),
      sender: "them",
      speaker: "other",
      text: "Separate message",
    },
    {
      ...visualMessage("storm", 160, 610),
      sender: "them",
      speaker: "other",
      text: "Another separate message",
    },
  ];

  const merged = mergeVisuallyContinuousMessages(messages, [
    { firstId: "norway-first", secondId: "norway-last" },
  ]);

  assert.deepEqual(merged.map((message) => message.id), [
    "norway-first",
    "roommate",
    "storm",
  ]);
  assert.equal(merged[0]?.text, "First part Continuation");
});

test("uses the shared bubble interior when one bridge point is visually obstructed", () => {
  assert.equal(
    isVisuallyContinuousBridge([
      { nearestBubbleDistance: 277.5, pageDistance: 194.1 },
      { nearestBubbleDistance: 0, pageDistance: 194.1 },
      { nearestBubbleDistance: 0, pageDistance: 194.1 },
    ]),
    true,
  );
});

test("does not merge separate same-speaker bubbles when the bridge is page-like", () => {
  assert.equal(
    isVisuallyContinuousBridge([
      { nearestBubbleDistance: 120, pageDistance: 3 },
      { nearestBubbleDistance: 110, pageDistance: 5 },
      { nearestBubbleDistance: 118, pageDistance: 4 },
    ]),
    false,
  );
});

test("preserves an existing accepted visual continuation", () => {
  assert.equal(
    isVisuallyContinuousBridge([
      { nearestBubbleDistance: 0, pageDistance: 19.5 },
      { nearestBubbleDistance: 0, pageDistance: 19.5 },
      { nearestBubbleDistance: 0, pageDistance: 19.5 },
    ]),
    true,
  );
});

test("preserves unambiguous ML Kit language evidence on reconstructed messages", () => {
  const result = reconstructConversationFromOcrLines([
    line("I had a really good time", 24, 100, 190, 118, ["en"]),
    line("with you yesterday.", 24, 122, 165, 140, ["en"]),
    line("Me too.", 276, 166, 350, 184, ["en", "fr"]),
    line("Delivered", 296, 190, 350, 204),
  ]);

  assert.deepEqual(result.detectedMessages[0]?.languageEvidence, [
    { tag: "en", lineCount: 2 },
  ]);
  assert.equal(result.detectedMessages[1]?.languageEvidence, undefined);
});

test("uses relative visual styles, right extent, and avatar evidence for ambiguous Hinge geometry", () => {
  const messages: DetectedMessage[] = [
    {
      boundingBox: { height: 80, width: 510, x: 182, y: 420 },
      confidence: 0.45,
      id: "message-1",
      sender: "unknown",
      speaker: "unknown",
      text: "Sounds fun 😌 I just got back from the gym. About to go game a bit 🤓",
      xPosition: "center",
    },
    {
      boundingBox: { height: 120, width: 500, x: 171, y: 530 },
      confidence: 0.45,
      id: "message-2",
      sender: "unknown",
      speaker: "unknown",
      text: "Sounds like a solid evening 😌 Gym done, now gaming mode activated 🤓 What are you playing?",
      xPosition: "center",
    },
    {
      boundingBox: { height: 160, width: 530, x: 182, y: 690 },
      confidence: 0.45,
      id: "message-3",
      sender: "unknown",
      speaker: "unknown",
      text: "Hehe yeah! I played a game of Dota 2. Do you know it?",
      xPosition: "center",
    },
    {
      boundingBox: { height: 160, width: 510, x: 171, y: 900 },
      confidence: 0.45,
      id: "message-4",
      sender: "unknown",
      speaker: "unknown",
      text: "I actually had not heard of Dota 2 before. What is your favorite game?",
      xPosition: "center",
    },
  ];
  const result = resolveVisualBubbleAttributionFromEvidence(messages, [
    {
      avatarVariance: 12,
      backgroundVariance: 8,
      bubbleColor: { blue: 116, green: 42, red: 111 },
      id: "message-1",
      leftExtent: 0.19,
      rightExtent: 0.88,
    },
    {
      avatarVariance: 720,
      backgroundVariance: 8,
      bubbleColor: { blue: 238, green: 238, red: 238 },
      id: "message-2",
      leftExtent: 0.18,
      rightExtent: 0.76,
    },
    {
      avatarVariance: 10,
      backgroundVariance: 8,
      bubbleColor: { blue: 116, green: 42, red: 111 },
      id: "message-3",
      leftExtent: 0.19,
      rightExtent: 0.9,
    },
    {
      avatarVariance: 680,
      backgroundVariance: 8,
      bubbleColor: { blue: 238, green: 238, red: 238 },
      id: "message-4",
      leftExtent: 0.18,
      rightExtent: 0.77,
    },
  ]);

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them", "me", "them"],
  );
  assert.ok((result?.confidence ?? 0) >= 0.68);
});

test("visual attribution corrects a confident geometry-only Hinge-style layout", () => {
  const messages: DetectedMessage[] = [
    visualMessage("norway-me", 292, 560),
    visualMessage("roommate-them", 162, 620),
    visualMessage("storm-them", 162, 610),
  ];
  const result = resolveVisualBubbleAttributionFromEvidence(messages, [
    {
      avatarVariance: 12,
      backgroundVariance: 8,
      bubbleColor: { blue: 34, green: 0, red: 51 },
      id: "norway-me",
      leftExtent: 0.31,
      rightExtent: 0.9,
    },
    {
      avatarVariance: 640,
      backgroundVariance: 8,
      bubbleColor: { blue: 232, green: 232, red: 232 },
      id: "roommate-them",
      leftExtent: 0.17,
      rightExtent: 0.82,
    },
    {
      avatarVariance: 680,
      backgroundVariance: 8,
      bubbleColor: { blue: 232, green: 232, red: 232 },
      id: "storm-them",
      leftExtent: 0.17,
      rightExtent: 0.81,
    },
  ]);

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them", "them"],
  );
  assert.ok((result?.confidence ?? 0) >= 0.68);
});

function visualMessage(id: string, x: number, width: number): DetectedMessage {
  return {
    boundingBox: { height: 90, width, x, y: 100 },
    confidence: 0.4,
    id,
    sender: "unknown",
    speaker: "unknown",
    text: `Message ${id}`,
    xPosition: "center",
  };
}

test("uses visual styles for an unknown app and a different color theme without avatars", () => {
  const result = resolveVisualBubbleAttributionFromEvidence(
    [visualMessage("one", 190, 640), visualMessage("two", 130, 600)],
    [
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 42, green: 178, red: 28 },
        id: "one",
        leftExtent: 0.19,
        rightExtent: 0.9,
      },
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 210, green: 75, red: 240 },
        id: "two",
        leftExtent: 0.13,
        rightExtent: 0.73,
      },
    ],
  );

  assert.deepEqual(
    result?.messages.map((message) => message.sender),
    ["me", "them"],
  );
});

test("keeps manual confirmation available when visual styles and geometry are both weak", () => {
  const result = resolveVisualBubbleAttributionFromEvidence(
    [visualMessage("one", 190, 550), visualMessage("two", 185, 545)],
    [
      {
        avatarVariance: 8,
        backgroundVariance: 7,
        bubbleColor: { blue: 140, green: 140, red: 140 },
        id: "one",
        leftExtent: 0.19,
        rightExtent: 0.74,
      },
      {
        avatarVariance: 9,
        backgroundVariance: 7,
        bubbleColor: { blue: 145, green: 144, red: 143 },
        id: "two",
        leftExtent: 0.18,
        rightExtent: 0.73,
      },
    ],
  );

  assert.equal(result, null);
});

function visualEvidence(
  id: string,
  color: { blue: number; green: number; red: number },
  rightExtent: number,
  avatarVariance = 8,
): VisualBubbleEvidence {
  return {
    avatarVariance,
    backgroundVariance: 7,
    bubbleColor: color,
    id,
    leftExtent: 0.18,
    rightExtent,
  };
}

function sampledColor(
  id: string,
  color: { blue: number; green: number; red: number },
  coverage = 1,
  variance = 4,
): ImageColorSample {
  return { ...color, coverage, id, variance };
}

test("resolves the supplied cropped-bottom ME bubble from local visual prototypes", () => {
  const priorEvidence = [
    visualEvidence("message-1", { blue: 30, green: 0, red: 50 }, 0.91),
    visualEvidence("message-2", { blue: 232, green: 232, red: 232 }, 0.77, 680),
    visualEvidence("message-3", { blue: 31, green: 1, red: 51 }, 0.9),
    visualEvidence("message-4", { blue: 233, green: 233, red: 233 }, 0.78, 700),
  ];
  const result = resolveCroppedBottomBubbleFromEvidence({
    candidate: visualEvidence("message-5", { blue: 29, green: 1, red: 52 }, 0.9),
    candidateId: "message-5",
    obstruction: "composer-overlay",
    priorEvidence,
  });

  assert.deepEqual(result, {
    candidateId: "message-5",
    kind: "resolved",
    obstruction: "composer-overlay",
    prototypeSpeakers: result.prototypeSpeakers,
    prototypeConfidence: result.prototypeConfidence,
    sender: "me",
  });
  assert.ok((result.prototypeConfidence ?? 0) >= 0.68);
});

test("does not treat a fully visible lower message as cropped", () => {
  const candidate = visualEvidence("message-5", { blue: 30, green: 0, red: 50 }, 0.9);
  const result = getCroppedBottomObstruction({
    candidate,
    lowerSamples: [
      sampledColor("lower-1", { blue: 30, green: 0, red: 50 }),
      sampledColor("lower-2", { blue: 30, green: 0, red: 50 }),
      sampledColor("lower-3", { blue: 30, green: 0, red: 50 }),
    ],
    normalVisualAttributionRejected: true,
    pageColor: { blue: 245, green: 245, red: 245 },
  });

  assert.equal(result, null);
});

test("requires confirmation when an obstructed cropped bubble cannot uniquely match a prototype", () => {
  const priorEvidence = [
    visualEvidence("message-1", { blue: 30, green: 0, red: 50 }, 0.91),
    visualEvidence("message-2", { blue: 232, green: 232, red: 232 }, 0.77, 680),
    visualEvidence("message-3", { blue: 31, green: 1, red: 51 }, 0.9),
    visualEvidence("message-4", { blue: 233, green: 233, red: 233 }, 0.78, 700),
  ];
  const result = resolveCroppedBottomBubbleFromEvidence({
    candidate: visualEvidence("message-5", { blue: 132, green: 116, red: 142 }, 0.9),
    candidateId: "message-5",
    obstruction: "edge-coverage",
    priorEvidence,
  });

  assert.deepEqual(result, {
    candidateId: "message-5",
    kind: "needs-confirmation",
    obstruction: "edge-coverage",
    prototypeSpeakers: result.prototypeSpeakers,
    prototypeConfidence: result.prototypeConfidence,
    sender: null,
  });
  const unresolved = buildParsedConversation(
    [
      {
        ...visualMessage("message-5", 180, 600),
        sender: "unknown",
        speaker: "unknown",
      },
    ],
    { confidence: 0, meColumn: null, resolved: false },
  );
  assert.equal(needsSpeakerConfirmation(unresolved), true);
});

function physicalFailureOcrLines() {
  return [
    line("12.42", 88, 35, 180, 72),
    line("App Store", 38, 92, 170, 132),
    line("Tobias", 470, 205, 700, 252),
    line("Du matchede med Tobias den 16.05.2026", 250, 470, 925, 512),
    line("17. maj, 1.30 PM", 465, 570, 705, 612),
    line("Hey 😁", 360, 680, 535, 722),
    line("Lang tid siden - how goes? 😊", 360, 730, 1080, 772),
    line("Hey! Ja det er så :) stille og roligt,", 200, 900, 940, 942),
    line("nyder søndagen med en lille gåtur.", 200, 950, 865, 992),
    line("Hvad med dig?", 200, 1000, 500, 1042),
    line("Dobbelttryk for at", 165, 1100, 430, 1142),
    line("Lyder da fedt 😊", 315, 1240, 675, 1282),
    line("Her står den bare på arbejde. Har", 315, 1290, 1040, 1332),
    line("en app idé jeg går og nørkler", 315, 1340, 930, 1382),
    line("med... Men burde tage en pause", 315, 1390, 970, 1432),
    line("her snart haha", 315, 1440, 650, 1482),
    line("Spændende, hvad er det for en", 200, 1630, 890, 1672),
    line("app? :) altid vigtigt med pauser ;)", 200, 1680, 850, 1722),
    line("Det er en ai dating coach haha.", 315, 1880, 990, 1922),
    line("Vil lige teste om der er et marked", 315, 1930, 1010, 1972),
    line("eller ikke.", 315, 1980, 570, 2022),
    line("Vi burde da få gået anden", 315, 2170, 900, 2212),
    line("tur snart 😚", 315, 2220, 590, 2262),
    line("GIF", 35, 2290, 115, 2332),
    line("Skriv en besked", 180, 2290, 1000, 2332),
  ];
}

function recognizedTextFixture(lines: OcrLineInput[]): RecognizedText {
  const frame = {
    bottom: Math.max(...lines.map((item) => item.frame.bottom)),
    left: Math.min(...lines.map((item) => item.frame.left)),
    right: Math.max(...lines.map((item) => item.frame.right)),
    top: Math.min(...lines.map((item) => item.frame.top)),
  };

  return {
    blocks: [
      {
        frame,
        lines: lines.map((item) => ({
          elements: [],
          frame: item.frame,
          recognizedLanguages: item.recognizedLanguages ?? [],
          text: item.text,
        })),
        recognizedLanguages: [],
        text: "",
      },
    ],
    text: "",
  };
}

function rejectedCroppedCandidate(
  candidateId: string,
  normalizedTop: number,
  normalizedBottom: number,
  candidateIndex: number,
): NonNullable<VisualBubbleAttributionAttempt["croppedCandidateDiagnostics"]> {
  return {
    candidateEvidenceReady: true,
    candidateId,
    candidateIndex,
    candidateIsChronologicallyLast: true,
    composerOverlayDetected: false,
    croppedCandidate: false,
    edgeCoverageDetected: false,
    finalBounds: { normalizedBottom, normalizedTop },
    lowerProbeCoverage: [1, 1, 1],
    lowerViewport: true,
    normalVisualAttributionRejected: true,
    obstruction: null,
    prototype: {
      candidateToMeDistance: null,
      candidateToThemDistance: null,
      confidence: null,
      meSourceCount: 0,
      separationMargin: null,
      themSourceCount: 0,
      uniqueMatch: false,
    },
  };
}

function recoverySample(
  id: string,
  color: { blue: number; green: number; red: number },
  variance = 4,
) {
  return sampledColor(id, color, 1, variance);
}

function recoveryFixtureSamples(
  fragments: VisualBubbleRecoveryFragment[],
  bubbleColors: Map<string, { blue: number; green: number; red: number }>,
  continuousPairs: Set<string>,
) {
  const page = { blue: 248, green: 248, red: 248 };
  const samples: ImageColorSample[] = [];

  for (const { message } of fragments) {
    samples.push(
      recoverySample(`recovery:${message.id}:page-left`, page),
      recoverySample(`recovery:${message.id}:page-right`, page),
      recoverySample(`recovery:${message.id}:avatar`, page),
    );
    const bubble = bubbleColors.get(message.id);
    for (let index = 0; index < 4; index += 1) {
      samples.push(
        recoverySample(
          `recovery:${message.id}:halo-${index}`,
          bubble ?? page,
        ),
      );
    }
  }

  for (const first of fragments) {
    for (const second of fragments) {
      if (first.message.boundingBox.y >= second.message.boundingBox.y) continue;
      const key = `${first.message.id}:${second.message.id}`;
      const bridgeColor = continuousPairs.has(key)
        ? bubbleColors.get(first.message.id) ?? { blue: 31, green: 1, red: 51 }
        : page;
      for (let index = 0; index < 3; index += 1) {
        samples.push(
          recoverySample(`recovery:${key}:bridge-${index}`, bridgeColor),
        );
      }
    }
  }

  return samples;
}

test("reconstructs the physical 25-line OCR failure as five visual bubbles", () => {
  const fragments = reconstructVisualRecoveryFragmentsFromOcrLines(
    physicalFailureOcrLines(),
  );
  assert.deepEqual(
    fragments.filter((fragment) => !fragment.recoverable).map((fragment) => fragment.message.id),
    [
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
      "message-7",
      "message-8",
    ],
  );
  assert.deepEqual(
    fragments.filter((fragment) => fragment.recoverable).map((fragment) => fragment.ocrLineIndexes),
    [[23], [25]],
  );

  const outgoing = { blue: 30, green: 0, red: 50 };
  const incoming = { blue: 232, green: 232, red: 232 };
  const bubbleColors = new Map([
    ["message-2", outgoing],
    ["message-3", incoming],
    ["message-5", outgoing],
    ["message-6", incoming],
    ["message-7", outgoing],
    ["message-8", outgoing],
  ]);
  const proposal = reconstructVisualBubblesFromSamples({
    fragments,
    imageWidth: 1170,
    samples: recoveryFixtureSamples(
      fragments,
      bubbleColors,
      new Set([
        "message-7:message-8",
        "message-8:recovery-line-23",
      ]),
    ),
  });

  assert.equal(proposal.messages.length, 5);
  assert.deepEqual(proposal.diagnostics.excludedFragmentIds, [
    "message-1",
    "message-4",
    "recovery-line-25",
  ]);
  assert.deepEqual(proposal.diagnostics.recoveredOcrLineIndexes, [23]);
  assert.deepEqual(
    proposal.messages.map((message) => message.id),
    ["message-2", "message-3", "message-5", "message-6", "message-7"],
  );
  assert.ok(proposal.messages.at(-1)?.text.includes("tur snart 😚"));

  const attribution = resolveVisualBubbleAttributionFromEvidence(
    proposal.messages,
    proposal.messages.map((message) => {
      const isOutgoing = ["message-2", "message-5", "message-7"].includes(message.id);
      return visualEvidence(
        message.id,
        isOutgoing ? outgoing : incoming,
        isOutgoing ? 0.92 : 0.76,
        isOutgoing ? 8 : 700,
      );
    }),
  );
  assert.deepEqual(
    attribution?.messages.map((message) => message.sender),
    ["me", "them", "me", "them", "me"],
  );
  assert.equal(attribution?.messages.at(-1)?.sender, "me");
  const parsedConversation = buildParsedConversation(attribution?.messages ?? []);
  assert.equal(parsedConversation.latestMessageSender, "me");
  assert.equal(parsedConversation.shouldGenerateDirectReply, false);
});

test("retains both candidate traces when a five-bubble recovery fails the obstruction commit gate", async () => {
  const sourceLines = physicalFailureOcrLines();
  const fragments = reconstructVisualRecoveryFragmentsFromOcrLines(sourceLines);
  const outgoing = { blue: 30, green: 0, red: 50 };
  const incoming = { blue: 232, green: 232, red: 232 };
  const bubbleColors = new Map([
    ["message-2", outgoing],
    ["message-3", incoming],
    ["message-5", outgoing],
    ["message-6", incoming],
    ["message-7", outgoing],
    ["message-8", outgoing],
  ]);
  const recoveryProposal = reconstructVisualBubblesFromSamples({
    fragments,
    imageHeight: 2532,
    imageWidth: 1170,
    samples: recoveryFixtureSamples(
      fragments,
      bubbleColors,
      new Set([
        "message-7:message-8",
        "message-8:recovery-line-23",
      ]),
    ),
  });
  const initialCandidate = rejectedCroppedCandidate(
    "message-8",
    0.848,
    0.868,
    7,
  );
  const recoveredCandidate = rejectedCroppedCandidate(
    "message-7",
    0.742,
    0.894,
    4,
  );
  const events: Array<{
    metadata: Record<string, unknown>;
    stage: string;
  }> = [];

  const result = await extractChatTextFromImage(
    "file:///diagnostic-fixture.png",
    "analysis-test",
    {
      inspectAttribution: async ({ stagePrefix }) => ({
        attribution: null,
        continuityDiagnostics: [],
        croppedCandidateDiagnostics:
          stagePrefix === "recovered"
            ? recoveredCandidate
            : initialCandidate,
        croppedFallback: null,
        evidenceDiagnostics: [],
        outcome: "low-confidence-or-incomplete-bubble-evidence" as const,
      }),
      inspectRecovery: async () => recoveryProposal,
      recognizeText: async () => recognizedTextFixture(sourceLines),
      trace: (stage, metadata = {}) => {
        events.push({ metadata, stage });
      },
    },
  );

  assert.equal(recoveryProposal.messages.length, 5);
  assert.equal(result.detectedMessages.length, 8);
  assert.deepEqual(
    result.detectedMessages.map((message) => message.sender),
    ["me", "me", "me", "them", "me", "me", "me", "me"],
  );
  assert.equal(result.parsedConversation.speakerAttributionResolved, true);

  const commitEvent = events.find(
    (event) => event.stage === "visual.recovery.commit-decision",
  );
  assert.deepEqual(commitEvent?.metadata.rejectionReasons, ["no-obstruction"]);
  assert.equal(commitEvent?.metadata.committed, false);

  const snapshotEvent = events.find(
    (event) => event.stage === "visual.recovery.attempt-snapshots",
  );
  assert.deepEqual(snapshotEvent?.metadata.initialCandidate, initialCandidate);
  assert.deepEqual(snapshotEvent?.metadata.recoveredCandidate, recoveredCandidate);
  assert.equal(
    events.every((event) =>
      isContentFreeDiagnosticPayload({
        ...event.metadata,
        stage: event.stage,
      }),
    ),
    true,
  );
});

test("resolves an equivalent cropped final THEM bubble from local prototypes", () => {
  const priorEvidence = [
    visualEvidence("message-1", { blue: 30, green: 0, red: 50 }, 0.91),
    visualEvidence("message-2", { blue: 232, green: 232, red: 232 }, 0.77, 680),
    visualEvidence("message-3", { blue: 31, green: 1, red: 51 }, 0.9),
    visualEvidence("message-4", { blue: 233, green: 233, red: 233 }, 0.78, 700),
  ];
  const result = resolveCroppedBottomBubbleFromEvidence({
    candidate: visualEvidence("message-5", { blue: 231, green: 232, red: 234 }, 0.78, 690),
    candidateId: "message-5",
    obstruction: "composer-overlay",
    priorEvidence,
  });

  assert.equal(result.kind, "resolved");
  assert.equal(result.sender, "them");
  const parsedConversation = buildParsedConversation([
    {
      ...visualMessage("message-5", 180, 600),
      sender: result.sender ?? "unknown",
      speaker: result.sender === "them" ? "other" : "unknown",
    },
  ]);
  assert.equal(parsedConversation.latestMessageSender, "them");
  assert.equal(parsedConversation.shouldGenerateDirectReply, true);
});

test("does not commit visual recovery for a fully visible lower bubble", () => {
  assert.equal(
    shouldCommitVisualBubbleRecovery({
      chronologicallyLast: true,
      lowerViewport: true,
      obstruction: null,
      proposalChanged: true,
    }),
    false,
  );
  assert.equal(
    shouldCommitVisualBubbleRecovery({
      chronologicallyLast: true,
      lowerViewport: true,
      obstruction: "composer-overlay",
      proposalChanged: true,
    }),
    true,
  );
});
