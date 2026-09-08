import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  analyzeScreenshot as requestAnalysis,
  selectPreviousWingrSuggestions,
} from "../lib/wingr-ai";
import { posthog } from "../lib/posthog";
import type {
  ConversationMessage,
  ReplyTone,
  SuggestedReply,
  VibeCheck,
} from "../types/wingr";

export type ConversationFlowError = {
  kind: "permission" | "analysis" | "replies";
  message: string;
};
export type AnalysisStatus = "idle" | "analyzing" | "ready" | "error";
export type RepliesStatus = "idle" | "generating" | "ready" | "error";

export function useConversationFlow() {
  const [selectedScreenshotUri, setSelectedScreenshotUri] = useState<
    string | null
  >(null);
  const [extraContext, setExtraContext] = useState("");
  const [selectedTone, setSelectedTone] = useState<ReplyTone>("playful");
  const [generatedReplies, setGeneratedReplies] = useState<SuggestedReply[]>(
    [],
  );
  const [lastGeneratedReplyId, setLastGeneratedReplyId] = useState<
    string | null
  >(null);
  const [vibeCheck, setVibeCheck] = useState<VibeCheck | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [repliesStatus, setRepliesStatus] = useState<RepliesStatus>("idle");
  const [error, setError] = useState<ConversationFlowError | null>(null);
  const toneRef = useRef<ReplyTone>("playful");
  const contextRef = useRef("");
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const screenshotRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      requestIdRef.current += 1;
    },
    [],
  );

  const cancelRequest = () => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  };
  const resetGeneratedState = () => {
    cancelRequest();
    setMessages([]);
    setVibeCheck(null);
    setGeneratedReplies([]);
    setLastGeneratedReplyId(null);
    toneRef.current = "playful";
    setSelectedTone("playful");
    setAnalysisStatus("idle");
    setRepliesStatus("idle");
    setError(null);
  };
  const reset = () => {
    screenshotRef.current = null;
    setSelectedScreenshotUri(null);
    contextRef.current = "";
    setExtraContext("");
    resetGeneratedState();
  };
  const pickScreenshot = async () => {
    setError(null);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error("Photo access is needed to choose a chat screenshot.");
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ["images"],
        quality: 1,
      });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (!uri) return null;
      screenshotRef.current = uri;
      setSelectedScreenshotUri(uri);
      contextRef.current = "";
      setExtraContext("");
      resetGeneratedState();
      posthog.capture("screenshot_selected");
      return uri;
    } catch (failure) {
      setError({
        kind: "permission",
        message:
          failure instanceof Error
            ? failure.message
            : "Wingr could not open your photo library.",
      });
      return null;
    }
  };

  // Initial analysis and explicit refresh share one image-based generation path.
  const runAnalysis = async (
    uri: string | null,
    context: string,
    append: boolean,
    isOnboardingGeneration = false,
  ) => {
    if (!uri) {
      const error: ConversationFlowError = { kind: "analysis", message: "Choose a screenshot first." };
      setError(error);
      setAnalysisStatus("error");
      return { status: "error" as const, error };
    }
    // Ignore double taps; replacing a screenshot/reset still cancels this request.
    if (controllerRef.current) return "cancelled" as const;
    const tone = toneRef.current;
    const previousWingrSuggestions = append
      ? selectPreviousWingrSuggestions(generatedReplies)
      : undefined;
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setLastGeneratedReplyId(null);
    contextRef.current = context;
    setExtraContext(context);
    setRepliesStatus("generating");
    if (!append) {
      setAnalysisStatus("analyzing");
      setGeneratedReplies([]);
      setVibeCheck(null);
      setMessages([]);
    }
    const startedAt = Date.now();
    posthog.capture(
      append ? "reply_generation_started" : "screenshot_analysis_started",
    );
    try {
      const result = await requestAnalysis({
        screenshotUri: uri,
        selectedTone: tone,
        extraContext: context,
        isOnboardingGeneration,
        previousWingrSuggestions,
        requestId: id,
        signal: controller.signal,
      });
      if (id !== requestIdRef.current) return "cancelled" as const;
      setMessages(result.messages);
      setVibeCheck(result.vibeCheck);
      setGeneratedReplies((current) =>
        append ? [...current, ...result.replies] : result.replies,
      );
      setLastGeneratedReplyId(result.replies[0].id);
      setAnalysisStatus("ready");
      setRepliesStatus("ready");
      posthog.capture(
        append ? "reply_generated" : "screenshot_analysis_completed",
        {
          tone,
          message_count: result.messages.length,
          duration_ms: Date.now() - startedAt,
        },
      );
      return "ready" as const;
    } catch (failure) {
      if (id !== requestIdRef.current) return "cancelled" as const;
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.info("[Wingr flow] screenshot analysis failed", {
          errorName: failure instanceof Error ? failure.name : "unknown",
          isOnboardingGeneration,
          requestId: id,
        });
      }
      if (!append) setAnalysisStatus("error");
      setRepliesStatus(append ? "error" : "idle");
      const error: ConversationFlowError = {
        kind: append ? "replies" : "analysis",
        message:
          failure instanceof Error
            ? failure.message
            : "Wingr could not analyze that screenshot. Please try again.",
      };
      setError(error);
      posthog.capture(
        append ? "reply_generation_failed" : "screenshot_analysis_failed",
        { duration_ms: Date.now() - startedAt },
      );
      return { status: "error" as const, error };
    } finally {
      if (id === requestIdRef.current) controllerRef.current = null;
    }
  };
  const analyzeScreenshot = (
    uri = screenshotRef.current,
    context = contextRef.current,
  ) => runAnalysis(uri, context.trim(), false);
  const analyzeOnboardingScreenshot = (
    uri = screenshotRef.current,
    context = contextRef.current,
  ) => runAnalysis(uri, context.trim(), false, true);
  const refreshReplies = async () =>
    (await runAnalysis(
      screenshotRef.current,
      contextRef.current.trim(),
      true,
    )) === "ready";
  const changeTone = async (tone: ReplyTone) => {
    posthog.capture("reply_tone_changed", {
      tone,
      previous_tone: toneRef.current,
    });
    toneRef.current = tone;
    setSelectedTone(tone);
    return true;
  };

  return {
    analysisStatus,
    analyzeOnboardingScreenshot,
    analyzeScreenshot,
    changeTone,
    clearError: () => setError(null),
    error,
    extraContext,
    generatedReplies,
    lastGeneratedReplyId,
    messages,
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
