import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import {
  buildProvisionalVibeCheck,
  extractScreenshotConversation,
  generateReplies,
  refineVibeCheck,
} from "../lib/wingr-ai";
import { getConversationBackendContract } from "../lib/conversation-attribution-contract";
import { posthog } from "../lib/posthog";
import { rebuildOcrResultWithConfirmedUserSide } from "../lib/wingr-ocr";
import type {
  OcrResult,
  ParsedConversation,
  ReplyTone,
  SuggestedReply,
  VibeCheck,
} from "../types/wingr";

function getConversationStateMetadata(parsedConversation?: ParsedConversation | null) {
  const messages = parsedConversation?.messages ?? [];
  const latestMeIndex = [...messages].map((message) => message.sender).lastIndexOf("me");

  return {
    hasParsedConversation: Boolean(parsedConversation),
    latestMessageSender: messages[messages.length - 1]?.sender ?? "unknown",
    messageCount: messages.length,
    themMessagesAfterLatestMe: messages
      .slice(latestMeIndex + 1)
      .filter((message) => message.sender === "them").length,
  };
}

export type ConversationFlowError = {
  kind: "permission" | "ocr" | "vibe" | "replies";
  message: string;
};

export type AnalysisStatus = "idle" | "analyzing" | "ready" | "error";
export type RepliesStatus = "idle" | "generating" | "ready" | "error";
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function logConversationFlow(
  stage: string,
  metadata?: Record<string, unknown>,
) {
  if (__DEV__) {
    console.info(`[Wingr flow] ${stage}`, metadata ?? {});
  }
}

export function useConversationFlow() {
  const [selectedScreenshotUri, setSelectedScreenshotUri] = useState<
    string | null
  >(null);
  const [chatTranscript, setChatTranscript] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [replyContext, setReplyContext] = useState("");
  const [selectedTone, setSelectedTone] = useState<ReplyTone>("playful");
  const [generatedReplies, setGeneratedReplies] = useState<SuggestedReply[]>(
    [],
  );
  const [lastGeneratedReplyId, setLastGeneratedReplyId] = useState<
    string | null
  >(null);
  const [vibeCheck, setVibeCheck] = useState<VibeCheck | null>(null);
  const [parsedConversation, setParsedConversation] =
    useState<ParsedConversation | null>(null);
  const [pendingSpeakerOcr, setPendingSpeakerOcr] = useState<OcrResult | null>(
    null,
  );
  const [pendingSpeakerContext, setPendingSpeakerContext] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [repliesStatus, setRepliesStatus] = useState<RepliesStatus>("idle");
  const [error, setError] = useState<ConversationFlowError | null>(null);
  const analysisRequestIdRef = useRef(0);
  const replyRequestIdRef = useRef(0);

  const resetGeneratedState = () => {
    replyRequestIdRef.current += 1;
    setChatTranscript("");
    setParsedConversation(null);
    setPendingSpeakerOcr(null);
    setPendingSpeakerContext("");
    setVibeCheck(null);
    setGeneratedReplies([]);
    setLastGeneratedReplyId(null);
    setSelectedTone("playful");
    setReplyContext("");
    setAnalysisStatus("idle");
    setRepliesStatus("idle");
    setError(null);
  };

  const reset = () => {
    analysisRequestIdRef.current += 1;
    setSelectedScreenshotUri(null);
    setExtraContext("");
    resetGeneratedState();
  };

  const pickScreenshot = async () => {
    setError(null);

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setError({
          kind: "permission",
          message: "Photo access is needed to choose a chat screenshot.",
        });
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ["images"],
        quality: 1,
      });
      const screenshotUri = result.canceled
        ? null
        : result.assets[0]?.uri?.trim() || null;

      if (!screenshotUri) {
        return null;
      }

      analysisRequestIdRef.current += 1;
      setSelectedScreenshotUri(screenshotUri);
      resetGeneratedState();
      posthog.capture('screenshot_selected');
      return screenshotUri;
    } catch (pickerError) {
      setError({
        kind: "permission",
        message: getErrorMessage(
          pickerError,
          "Wingr could not open your photo library. Please try again.",
        ),
      });
      return null;
    }
  };

  const applyConversationResult = (
    ocr: OcrResult,
    nextVibeCheck: VibeCheck,
  ) => {
    replyRequestIdRef.current += 1;
    setChatTranscript(ocr.transcriptText || "");
    setParsedConversation(ocr.parsedConversation ?? null);
    setGeneratedReplies([]);
    setLastGeneratedReplyId(null);
    setSelectedTone(nextVibeCheck.bestTone ?? "playful");
    setVibeCheck(nextVibeCheck);
    setAnalysisStatus("ready");
  };

  const analyzeScreenshot = async (
    screenshotUri = selectedScreenshotUri,
    nextExtraContext = "",
  ) => {
    if (!screenshotUri?.trim()) {
      logConversationFlow("analysis blocked", { reason: "missing-screenshot" });
      setError({
        kind: "ocr",
        message: "Choose a screenshot before checking the vibe.",
      });
      setAnalysisStatus("error");
      return "error" as const;
    }

    const requestId = analysisRequestIdRef.current + 1;
    const trimmedContext = nextExtraContext.trim();

    analysisRequestIdRef.current = requestId;
    setExtraContext(nextExtraContext);
    setError(null);
    setAnalysisStatus("analyzing");
    setRepliesStatus("idle");
    setReplyContext(trimmedContext);
    setPendingSpeakerOcr(null);
    setPendingSpeakerContext("");
    setVibeCheck(null);
    replyRequestIdRef.current += 1;
    setGeneratedReplies([]);
    setLastGeneratedReplyId(null);

    let failureKind: ConversationFlowError["kind"] = "ocr";

    posthog.capture('screenshot_analysis_started');

    try {
      logConversationFlow("analysis started");
      const ocr = await extractScreenshotConversation(screenshotUri);

      logConversationFlow("ocr completed", {
        detectedMessages: ocr.detectedMessages.length,
        source: ocr.source,
        transcriptLength: ocr.transcriptText.length,
      });

      if (analysisRequestIdRef.current !== requestId) {
        logConversationFlow("analysis cancelled", { stage: "after-ocr" });
        return "cancelled" as const;
      }

      if (!ocr.transcriptText?.trim() || ocr.detectedMessages.length === 0) {
        throw new Error(
          "Wingr could not find a readable conversation in that screenshot.",
        );
      }

      const backendContract = getConversationBackendContract(
        ocr.parsedConversation,
      );

      if (backendContract.kind === "needsSpeakerConfirmation") {
        logConversationFlow("speaker confirmation required");
        setChatTranscript(ocr.transcriptText);
        setParsedConversation(ocr.parsedConversation);
        setPendingSpeakerOcr(ocr);
        setPendingSpeakerContext(nextExtraContext);
        setAnalysisStatus("idle");
        return "needsConfirmation" as const;
      }

      failureKind = "vibe";
      const provisionalVibeCheck = buildProvisionalVibeCheck(ocr);
      logConversationFlow(
        "vibe check request",
        getConversationStateMetadata(backendContract.parsedConversation),
      );
      const completedVibeCheck = await refineVibeCheck({
        extraContext: nextExtraContext || undefined,
        fallbackVibeCheck: provisionalVibeCheck,
        parsedConversation: backendContract.parsedConversation,
        transcriptText: ocr.transcriptText,
      });

      if (analysisRequestIdRef.current !== requestId) {
        logConversationFlow("analysis cancelled", { stage: "after-vibe" });
        return "cancelled" as const;
      }

      applyConversationResult(ocr, completedVibeCheck);
      logConversationFlow("vibe check ready", {
        bestTone: completedVibeCheck.bestTone,
      });
      posthog.capture('screenshot_analysis_completed', {
        best_tone: completedVibeCheck.bestTone,
        message_count: ocr.detectedMessages.length,
        ocr_source: ocr.source,
      });
      return "ready" as const;
    } catch (analysisError) {
      if (analysisRequestIdRef.current !== requestId) {
        return "cancelled" as const;
      }

      setAnalysisStatus("error");
      const errorMessage = getErrorMessage(
        analysisError,
        failureKind === "ocr"
          ? "Wingr could not read that screenshot. Try another image."
          : "Wingr could not finish the vibe check. Please try again.",
      );
      setError({
        kind: failureKind,
        message: errorMessage,
      });
      logConversationFlow("analysis failed", {
        kind: failureKind,
        message: getErrorMessage(analysisError, "Unknown analysis error."),
      });
      posthog.capture('screenshot_analysis_failed', {
        failure_kind: failureKind,
      });
      return "error" as const;
    }
  };

  const confirmSpeakerSide = async (userSide: "left" | "right") => {
    if (!pendingSpeakerOcr) {
      return false;
    }

    const requestId = analysisRequestIdRef.current + 1;
    const confirmedOcr = rebuildOcrResultWithConfirmedUserSide(
      pendingSpeakerOcr,
      userSide,
    );

    analysisRequestIdRef.current = requestId;
    setAnalysisStatus("analyzing");
    setError(null);
    setPendingSpeakerOcr(null);
    posthog.capture('speaker_side_confirmed', { side: userSide });

    try {
      const provisionalVibeCheck = buildProvisionalVibeCheck(confirmedOcr);
      logConversationFlow(
        "vibe check request after speaker confirmation",
        getConversationStateMetadata(confirmedOcr.parsedConversation),
      );
      const completedVibeCheck = await refineVibeCheck({
        extraContext: pendingSpeakerContext || undefined,
        fallbackVibeCheck: provisionalVibeCheck,
        parsedConversation: confirmedOcr.parsedConversation,
        transcriptText: confirmedOcr.transcriptText,
      });

      if (analysisRequestIdRef.current !== requestId) {
        return false;
      }

      applyConversationResult(confirmedOcr, completedVibeCheck);
      setPendingSpeakerContext("");
      return true;
    } catch (analysisError) {
      setAnalysisStatus("error");
      setError({
        kind: "vibe",
        message: getErrorMessage(
          analysisError,
          "Wingr could not finish the vibe check.",
        ),
      });
      return false;
    }
  };

  const cancelSpeakerConfirmation = () => {
    setPendingSpeakerOcr(null);
    setPendingSpeakerContext("");
    setAnalysisStatus("idle");
    setError(null);
  };

  const generateRepliesForTone = async (
    tone: ReplyTone,
    nextContext: string,
  ) => {
    if (!vibeCheck || !chatTranscript.trim()) {
      throw new Error("Finish the vibe check before generating replies.");
    }

    logConversationFlow(
      "reply generation request",
      getConversationStateMetadata(parsedConversation),
    );

    return generateReplies({
      extraContext: nextContext || undefined,
      parsedConversation: parsedConversation ?? undefined,
      screenshotUri: selectedScreenshotUri,
      selectedTone: tone,
      transcriptText: chatTranscript,
      vibeCheck,
    });
  };

  const appendReplyForTone = async (
    tone: ReplyTone,
    nextContext: string,
    fallbackMessage: string,
  ) => {
    const generationStartedAt = Date.now();
    const requestId = replyRequestIdRef.current + 1;

    replyRequestIdRef.current = requestId;
    setLastGeneratedReplyId(null);
    setRepliesStatus("generating");
    setError(null);

    try {
      logConversationFlow("reply generation started", { tone });
      const nextReplyBatch = await generateRepliesForTone(tone, nextContext);

      if (replyRequestIdRef.current !== requestId) {
        return false;
      }

      const nextReply = nextReplyBatch[tone]?.[0];

      if (!nextReply) {
        throw new Error(
          "Wingr couldn’t create another reply. Try again.",
        );
      }

      const generatedReply = {
        ...nextReply,
        id: `${nextReply.id || tone}-${requestId}`,
      };

      setGeneratedReplies((currentReplies) => [
        ...currentReplies,
        generatedReply,
      ]);
      setLastGeneratedReplyId(generatedReply.id);
      setRepliesStatus("ready");
      const durationMs = Date.now() - generationStartedAt;
      logConversationFlow("reply ready", { durationMs, tone });
      posthog.capture('reply_generated', { tone, duration_ms: durationMs });
      return true;
    } catch (generationError) {
      if (replyRequestIdRef.current !== requestId) {
        return false;
      }

      setRepliesStatus("error");
      setError({
        kind: "replies",
        message: getErrorMessage(generationError, fallbackMessage),
      });
      const durationMs = Date.now() - generationStartedAt;
      logConversationFlow("reply generation failed", { durationMs, tone });
      posthog.capture('reply_generation_failed', { tone, duration_ms: durationMs });
      return false;
    }
  };

  const generateRepliesForSelectedTone = async () => {
    const nextContext = extraContext.trim();

    setReplyContext(nextContext);
    return appendReplyForTone(
      selectedTone,
      nextContext,
      "Wingr could not generate a reply.",
    );
  };

  const changeTone = async (tone: ReplyTone) => {
    posthog.capture('reply_tone_changed', { tone, previous_tone: selectedTone });
    setSelectedTone(tone);
    return true;
  };

  const refreshReplies = async () => {
    posthog.capture('reply_refreshed', { tone: selectedTone });
    return appendReplyForTone(
      selectedTone,
      replyContext,
      "Wingr could not generate a new reply.",
    );
  };

  const clearError = () => setError(null);

  return {
    analysisStatus,
    analyzeScreenshot,
    cancelSpeakerConfirmation,
    changeTone,
    chatTranscript,
    clearError,
    confirmSpeakerSide,
    error,
    extraContext,
    generatedReplies,
    generateRepliesForSelectedTone,
    lastGeneratedReplyId,
    parsedConversation,
    pendingSpeakerOcr,
    pickScreenshot,
    refreshReplies,
    repliesStatus,
    reset,
    selectedScreenshotUri,
    selectedTone,
    setError,
    vibeCheck,
  };
}

export type ConversationFlow = ReturnType<typeof useConversationFlow>;
