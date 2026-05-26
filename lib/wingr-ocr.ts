import { hasWingrBackend, postFormToWingrBackend } from './wingr-api';
import type { OcrResult } from '../types/wingr';

type BackendOcrResponse = {
  transcriptText?: string;
  transcript?: string;
  confidence?: number;
};

const MOCK_TRANSCRIPT = [
  'Them: haha okay maybe that was a weak answer',
  'You: I will allow it for now',
  'Them: generous of you',
  'You: I have my moments',
].join('\n');

export async function extractChatTextFromImage(screenshotUri: string): Promise<OcrResult> {
  if (!screenshotUri) {
    throw new Error('No screenshot selected.');
  }

  if (!hasWingrBackend()) {
    return {
      source: 'mock',
      transcriptText: MOCK_TRANSCRIPT,
    };
  }

  try {
    const formData = new FormData();
    const file = {
      name: 'chat-screenshot.jpg',
      type: 'image/jpeg',
      uri: screenshotUri,
    };

    formData.append('image', file as unknown as Blob);

    const result = await postFormToWingrBackend<BackendOcrResponse>('/ocr', formData);
    const transcriptText = result.transcriptText ?? result.transcript;

    if (!transcriptText?.trim()) {
      throw new Error('OCR returned an empty transcript.');
    }

    return {
      confidence: result.confidence,
      source: 'backend',
      transcriptText: transcriptText.trim(),
    };
  } catch {
    return {
      source: 'mock',
      transcriptText: MOCK_TRANSCRIPT,
    };
  }
}
