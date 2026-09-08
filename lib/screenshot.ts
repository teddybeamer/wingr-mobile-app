import { screenshotDataUrl } from "./screenshot-data";
import { File } from "expo-file-system";
import { MAX_IMAGE_BYTES } from "../supabase/functions/_shared/conversation";

export async function readScreenshot(uri: string) {
  let stage = "create-file";
  let file: File | null = null;
  let fileExists: boolean | null = null;
  let fileSize: number | null = null;
  try {
    file = new File(uri);
    stage = "validate-file";
    fileExists = file.exists;
    fileSize = file.size;
    if (!fileExists || fileSize > MAX_IMAGE_BYTES)
      throw new Error("Choose a screenshot under 10 MB.");
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr screenshot] local file accepted", {
        exists: fileExists,
        size: fileSize,
      });
    }
    stage = "read-base64";
    const base64 = await file.base64();
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr screenshot] local read complete", {
        base64Length: base64.length,
      });
    }
    stage = "identify-image-format";
    return screenshotDataUrl(base64);
  } catch (failure) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("[Wingr screenshot] local read failed", {
        errorName: failure instanceof Error ? failure.name : "unknown",
        fileExists,
        fileSize,
        stage,
      });
    }
    throw failure;
  }
}
