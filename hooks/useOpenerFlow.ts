import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";

import { captureSafely } from "../lib/conversation-diagnostics";
import { posthog } from "../lib/posthog";
import { ConversationApiError, type BackendErrorCode } from "../lib/wingr-api";
import {
  requestAnotherOpener,
  requestStarters,
  selectPreviousOpeners,
} from "../lib/wingr-opener";
import { ConversationError } from "../supabase/functions/_shared_v2/conversation";
import {
  OPENER_OUTPUT_CONTRACT,
  type UnusableProfileReason,
} from "../supabase/functions/_shared_v2/opener";
import type { ProfileAngle, ReplyTone, SuggestedReply } from "../types/wingr";

export type OpenerFlowError = {
  id: number;
  // "permission": the photo library; "starters": the first read of the
  // profile; "opener": one more opener.
  kind: "permission" | "starters" | "opener";
  message: string;
  code?: BackendErrorCode;
  failureReason?: UnusableProfileReason;
  httpStatus?: number;
  retryAt?: string;
};
export type StartersStatus = "idle" | "analyzing" | "ready" | "error";

// Start Conversation: one profile screenshot, The Angle, and openers. Mirrors
// useConversationFlow (Get Replies) but talks to the ai-opener endpoint.
export function useOpenerFlow() {
  const [selectedScreenshotUri, setSelectedScreenshotUri] = useState<
    string | null
  >(null);
  const [angle, setAngle] = useState<ProfileAngle | null>(null);
  const [openers, setOpeners] = useState<SuggestedReply[]>([]);
  const [lastGeneratedOpenerId, setLastGeneratedOpenerId] = useState<
    string | null
  >(null);
  const [selectedTone, setSelectedTone] = useState<ReplyTone>("playful");
  const [startersStatus, setStartersStatus] = useState<StartersStatus>("idle");
  const [isGeneratingOpener, setIsGeneratingOpener] = useState(false);
  const [error, setError] = useState<OpenerFlowError | null>(null);
  const toneRef = useRef<ReplyTone>("playful");
  const screenshotRef = useRef<string | null>(null);
  const openersRef = useRef<SuggestedReply[]>([]);
  const requestIdRef = useRef(0);
  const errorIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  openersRef.current = openers;

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      requestIdRef.current += 1;
    },
    [],
  );

  const capture = (
    event: string,
    properties?: Parameters<typeof posthog.capture>[1],
  ) => {
    captureSafely(
      (name, values) => posthog.capture(name, values),
      event,
      properties,
    );
  };

  const cancelRequest = () => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsGeneratingOpener(false);
  };

  const resetResults = () => {
    cancelRequest();
    setAngle(null);
    setOpeners([]);
    setLastGeneratedOpenerId(null);
    setStartersStatus("idle");
    setError(null);
  };

  const reset = () => {
    screenshotRef.current = null;
    setSelectedScreenshotUri(null);
    toneRef.current = "playful";
    setSelectedTone("playful");
    resetResults();
  };

  const toFlowError = (
    failure: unknown,
    kind: OpenerFlowError["kind"],
  ): OpenerFlowError => {
    const apiError =
      failure instanceof ConversationApiError ? failure : undefined;
    const code =
      apiError?.errorCode ??
      (failure instanceof ConversationError ? failure.kind : undefined);
    return {
      id: ++errorIdRef.current,
      kind,
      code,
      failureReason: apiError?.profileFailureReason,
      httpStatus: apiError?.httpStatus,
      retryAt:
        failure instanceof ConversationError ? failure.retryAt : undefined,
      message:
        code === "unusable_screenshot"
          ? "WiNGR couldn’t read that image. Try another one."
          : failure instanceof ConversationError
            ? failure.message
            : kind === "opener"
              ? "WiNGR could not write another opener. Please try again."
              : "WiNGR could not read that image. Please try again.",
    };
  };

  const pickScreenshot = async () => {
    setError(null);
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error("Photo access is needed to choose a picture of them.");
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ["images"],
        quality: 1,
      });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (!uri) return null;
      screenshotRef.current = uri;
      setSelectedScreenshotUri(uri);
      resetResults();
      capture("opener_screenshot_selected");
      return uri;
    } catch (failure) {
      setError({
        id: ++errorIdRef.current,
        kind: "permission",
        message:
          failure instanceof Error
            ? failure.message
            : "WiNGR could not open your photo library.",
      });
      return null;
    }
  };

  // The first read: The Angle and one opener in the selected tone.
  const generateStarters = async () => {
    const uri = screenshotRef.current;
    if (!uri || controllerRef.current) return "cancelled" as const;
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setStartersStatus("analyzing");
    setAngle(null);
    setOpeners([]);
    setLastGeneratedOpenerId(null);
    const startedAt = Date.now();
    capture("opener_starters_started", {
      output_contract: OPENER_OUTPUT_CONTRACT,
    });
    try {
      const result = await requestStarters({
        requestId: id,
        screenshotUri: uri,
        selectedTone: toneRef.current,
        signal: controller.signal,
      });
      if (id !== requestIdRef.current) return "cancelled" as const;
      setAngle(result.angle);
      setOpeners(result.openers);
      setStartersStatus("ready");
      capture("opener_starters_completed", {
        duration_ms: Date.now() - startedAt,
        output_contract: OPENER_OUTPUT_CONTRACT,
      });
      return "ready" as const;
    } catch (failure) {
      if (id !== requestIdRef.current) return "cancelled" as const;
      const flowError = toFlowError(failure, "starters");
      setError(flowError);
      setStartersStatus("error");
      capture("opener_starters_failed", {
        duration_ms: Date.now() - startedAt,
        ...(flowError.code ? { error_code: flowError.code } : {}),
        ...(flowError.failureReason
          ? { failure_reason: flowError.failureReason }
          : {}),
        output_contract: OPENER_OUTPUT_CONTRACT,
      });
      return { status: "error" as const, error: flowError };
    } finally {
      if (id === requestIdRef.current) controllerRef.current = null;
    }
  };

  // One more opener in the selected tone, added below the others.
  const getAnotherOpener = async () => {
    const uri = screenshotRef.current;
    if (!uri || controllerRef.current) return false;
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const tone = toneRef.current;
    setError(null);
    setLastGeneratedOpenerId(null);
    setIsGeneratingOpener(true);
    capture("opener_generation_started", { tone });
    try {
      const opener = await requestAnotherOpener({
        previousOpeners: selectPreviousOpeners(openersRef.current),
        requestId: id,
        screenshotUri: uri,
        selectedTone: tone,
        signal: controller.signal,
      });
      if (id !== requestIdRef.current) return false;
      setOpeners((current) => [...current, opener]);
      setLastGeneratedOpenerId(opener.id);
      capture("opener_generated", { tone });
      return true;
    } catch (failure) {
      if (id !== requestIdRef.current) return false;
      const flowError = toFlowError(failure, "opener");
      setError(flowError);
      capture("opener_generation_failed", {
        ...(flowError.code ? { error_code: flowError.code } : {}),
        tone,
      });
      return false;
    } finally {
      if (id === requestIdRef.current) {
        controllerRef.current = null;
        setIsGeneratingOpener(false);
      }
    }
  };

  const changeTone = async (tone: ReplyTone) => {
    capture("opener_tone_changed", { tone, previous_tone: toneRef.current });
    toneRef.current = tone;
    setSelectedTone(tone);
    return true;
  };

  return {
    angle,
    changeTone,
    clearError: () => setError(null),
    error,
    generateStarters,
    getAnotherOpener,
    isGeneratingOpener,
    lastGeneratedOpenerId,
    openers,
    pickScreenshot,
    reset,
    selectedScreenshotUri,
    selectedTone,
    startersStatus,
  };
}
export type OpenerFlow = ReturnType<typeof useOpenerFlow>;
