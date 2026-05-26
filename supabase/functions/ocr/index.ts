import { handleCors } from '../_shared/cors.ts';
import { error, json } from '../_shared/http.ts';
import { extractTranscriptFromFile } from '../_shared/ocr.ts';

Deno.serve(async (request) => {
  const corsResponse = handleCors(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return error('Method not allowed.', 405);
  }

  try {
    const formData = await request.formData();
    const image = formData.get('image');

    if (!(image instanceof File)) {
      return error('Expected multipart form-data with an image file field named "image".', 400);
    }

    const result = await extractTranscriptFromFile(image);

    return json({
      confidence: result.confidence,
      mode: result.mode,
      transcriptText: result.transcriptText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR failed.';
    return error(message, 500);
  }
});
