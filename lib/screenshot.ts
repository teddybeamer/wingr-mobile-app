import { screenshotDataUrl } from "./screenshot-data";
import { File } from "expo-file-system";
import { MAX_IMAGE_BYTES } from "../supabase/functions/_shared/conversation";

export async function readScreenshot(uri: string) {
  const file = new File(uri);
  if (!file.exists || file.size > MAX_IMAGE_BYTES)
    throw new Error("Choose a screenshot under 10 MB.");
  const base64 = await file.base64();
  return screenshotDataUrl(base64);
}
