const DEFAULT_MOCK_TRANSCRIPT = [
  'THEM: haha okay maybe that was a weak answer',
  'ME: I will allow it for now',
  'THEM: generous of you',
  'ME: I have my moments',
].join('\n');

type OcrSpaceResponse = {
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string[] | string;
  ParsedResults?: Array<{
    ParsedText?: string;
  }>;
};

function getMockTranscript() {
  return Deno.env.get('OCR_MOCK_TRANSCRIPT')?.trim() || DEFAULT_MOCK_TRANSCRIPT;
}

export async function extractTranscriptFromFile(file: File) {
  const ocrApiKey = Deno.env.get('OCR_SPACE_API_KEY');

  if (!ocrApiKey) {
    return {
      confidence: undefined,
      mode: 'mock' as const,
      transcriptText: getMockTranscript(),
    };
  }

  const formData = new FormData();
  formData.append('file', file, file.name || 'chat-screenshot.jpg');
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('scale', 'true');

  const response = await fetch('https://api.ocr.space/parse/image', {
    body: formData,
    headers: {
      apikey: ocrApiKey,
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`OCR provider request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as OcrSpaceResponse;
  const transcriptText = payload.ParsedResults?.map((entry) => entry.ParsedText?.trim() ?? '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (payload.IsErroredOnProcessing || !transcriptText) {
    const message = Array.isArray(payload.ErrorMessage)
      ? payload.ErrorMessage.join('; ')
      : payload.ErrorMessage || 'OCR provider returned no transcript.';
    throw new Error(message);
  }

  return {
    confidence: undefined,
    mode: 'provider' as const,
    transcriptText,
  };
}
