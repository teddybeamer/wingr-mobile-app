# Wingr Supabase Edge Functions

This folder contains the backend scaffold for the current Wingr MVP flow:

1. screenshot upload -> `ocr`
2. transcript -> `ai-vibe-check`
3. transcript + tone + vibe check -> `ai-replies`

## What to set in Supabase

Add these secrets in the Supabase dashboard or CLI:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` optional, defaults to `deepseek/deepseek-v3.2`
- `OCR_SPACE_API_KEY` optional for real OCR via OCR.Space
- `OCR_MOCK_TRANSCRIPT` optional override for local testing

## Local setup

1. Install the Supabase CLI.
2. Link this repo to your Supabase project:

```bash
supabase login
supabase projects list
supabase link --project-ref YOUR_PROJECT_REF
```

3. Copy the example env file:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

4. Start the local function runtime:

```bash
supabase start
supabase functions serve
```

## Deploy

Deploy everything:

```bash
supabase functions deploy
```

Or deploy one at a time:

```bash
supabase functions deploy ocr
supabase functions deploy ai-vibe-check
supabase functions deploy ai-replies
```

## App config

Point the Expo app at your deployed functions base URL:

```env
EXPO_PUBLIC_WINGR_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

The mobile app should call:

- `POST /ocr`
- `POST /ai-vibe-check`
- `POST /ai-replies`

## Notes

- `ocr` uses OCR.Space when `OCR_SPACE_API_KEY` is configured.
- Without an OCR provider key, `ocr` returns a mock transcript so the end-to-end flow still works while you wire things up.
- `ai-vibe-check` and `ai-replies` call OpenRouter with structured JSON output.
