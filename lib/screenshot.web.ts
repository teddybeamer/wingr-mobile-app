import { screenshotDataUrl } from "./screenshot-data";
import { MAX_IMAGE_BYTES } from "../supabase/functions/_shared/conversation";

export async function readScreenshot(uri: string) {
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob.size > MAX_IMAGE_BYTES)
    throw new Error("Choose a screenshot under 10 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("Wingr could not read that screenshot."));
    reader.onload = () => {
      try {
        resolve(screenshotDataUrl(String(reader.result).split(",")[1] ?? ""));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(blob);
  });
}
