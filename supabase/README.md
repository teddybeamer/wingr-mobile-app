# Wingr Supabase Edge Functions

This folder contains the backend scaffold for the current Wingr MVP flow:

1. on-device OCR transcript -> `ai-vibe-check`
2. transcript + tone + vibe check -> `ai-replies`

## What to set in Supabase

Add these secrets in the Supabase dashboard or CLI:

- `OPENROUTER_API_KEY`
- `DEEPSEEK_MODEL` optional shared model, defaults to `deepseek/deepseek-v3.2`
- `VIBE_CHECK_MODEL` optional vibe-check model override, defaults to `google/gemini-2.5-flash-lite`
- `VIBE_CHECK_PROVIDER` optional vibe-check provider override
- `REPLY_MODEL` optional reply-generation model override
- `OPENROUTER_TIMEOUT_MS` optional request timeout, defaults to `20000`

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
supabase functions deploy ai-vibe-check
supabase functions deploy ai-replies
```

## App config

Point the Expo app at your deployed functions base URL:

```env
EXPO_PUBLIC_WINGR_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

The mobile app should call:

- `POST /ai-vibe-check`
- `POST /ai-replies`

## Notes

- `ai-vibe-check` uses Gemini 2.5 Flash-Lite through OpenRouter with structured JSON output.
- `ai-replies` stays on OpenRouter / DeepSeek.
- DeepSeek replies first use DeepInfra only: `provider: { only: ["deepinfra"], allow_fallbacks: false }`.
- If that request fails, the existing retry uses OpenRouter latency sorting with `data_collection: "deny"` and `zdr: true` preserved.
