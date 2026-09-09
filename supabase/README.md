# Wingr screenshot analysis

The app sends the original selected PNG/JPEG/WebP screenshot to `POST /ai-conversation`.
One Gemini 3.8 Flash request through OpenRouter reads the conversation, attributes ME/THEM,
assesses the vibe and generates one reply in the selected tone and conversation language.
The initial result supplies both the vibe card and reply card. Explicit refreshes use the same
endpoint with the original screenshot, tone and context. Images are not resized or reconstructed.

## Configuration

- Backend secret: `OPENROUTER_API_KEY` (see `functions/.env.example`).
- App: `EXPO_PUBLIC_WINGR_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1`.
- App identity: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Enable Anonymous Sign-Ins in Supabase Auth before deploying; the app creates and securely persists an anonymous session per installation.
- Model and 25-second provider deadline: `functions/_shared/openrouter.ts`.
- Reasoning: `reasoning: { effort: "medium" }`.
- Provider: standard Google Vertex only (`provider.only: ["google-vertex/global"]`,
  `service_tier: "default"`). Priority, Flex and other providers are excluded; no fallbacks.
- App network deadline: 35 seconds, including response body reads.
- Images: PNG/JPEG/WebP, at most 10 MB. Context: at most 4,000 characters.

Run locally with `supabase start` and `supabase functions serve` after configuring the secret.
This change requires a new native app build to reflect the removed native dependencies and
new direct file-system dependency. The installed Expo SDK remains 54; the required v56
reference was read and the used APIs were also checked against installed package types.

## Contract

Request: `{ screenshot: "data:image/png;base64,...", selectedTone: "playful" | "direct" | "casualSmallTalk", extraContext?: string, previousWingrSuggestions?: string[] }`. On an explicit refresh, the app sends at most the three latest suggestions already shown to the user. They are separate from screenshot context and let Gemini choose a different grounded reply; they are never conversation messages or user facts.

Response: `{ messages: [{ speaker: "ME" | "THEM", text: string }], replyable: true, vibeCheck: { interestLevel, conversationEnergy, bestTone, risk, summary }, replies: [string] }`.
The model can report `replyable: false` with no replies; the endpoint turns that into a terminal
422 error. Latest speaker is simply the last message's speaker and is not duplicated in the output.
Reply IDs and selected tone are attached in the app. Vibe `bestTone` is a recommendation and
never overrides the user's selected tone. Provider/network, timeout and malformed-output errors
end the request, without automatic retries, another model, fabricated results or repair calls.

## Privacy

Every call enforces `provider.zdr: true`, `data_collection: "deny"`, `allow_fallbacks: false`
and `require_parameters: true`. If no compatible private endpoint exists, the call fails closed.
Keep prompt/completion logging disabled in the OpenRouter account settings; this is an
account-level opt-in, not an invented request flag. No image, transcript, context, reply or
upstream error body is logged or stored by this endpoint. Failures log only a closed
error code and, when available, the numeric OpenRouter status. App analytics contain only event
names, tone, counts and duration. The selected local image remains available for explicit refresh.

## Validation and evaluation

`npm test` runs all unit tests; `npm run typecheck` checks the app and shared backend code.
`deno check supabase/functions/ai-conversation/index.ts` checks the runtime entrypoint when Deno is installed.

Deterministic validation checks technical usability: response parsing and completion status,
required fields, types, enums, counts, text lengths, nonempty replies and consistent replyability.
The speaker field must be `ME` or `THEM` to satisfy the schema; the backend does not reassess
which person said a message. Gemini owns attribution, conversation context, cropped/partial
screenshots, personal facts and names, grounding, reasonable inference and conversational sense.
Technically valid results pass through unchanged. Gemini's `replyable: false` result remains a
terminal unusable-screenshot error. There are no semantic heuristics or extra generation calls.

Real-image evaluation must be run separately using consented screenshot fixtures. For each fixture,
record expected visible messages/owners, latest hook, language and chosen tone, then review the
single live model result. Include cropped bottom bubbles, `haha`, long incoming/outgoing messages,
Instagram/Tinder/Hinge, dark mode, unusual colors, composer/UI text, English, Danish, mixed language,
ME-last conversations and no-conversation images. Check missing text is never invented and THEM
facts never become ME facts. Unit tests validate contracts and transport, not Gemini's vision.
No live screenshot evaluation or deployment is implied by passing mocked provider tests.

## Diagnosing failures

Error responses include `code` and an optional numeric `providerStatus`. The app
reconstructs messages from these validated fields rather than displaying upstream
error text. A Supabase HTTP 502 can wrap a different OpenRouter status, such as
401 (API key rejected), 402 (insufficient credits), 400 (request rejected), or 503
(provider unavailable). Inspect `providerStatus` before changing routing or models.
Never disable privacy controls to troubleshoot a failed request.

## Usage limit

Every authenticated anonymous user can dispatch 500 AI generation attempts in a rolling 30-day window. The count uses `attempted_at > now() - interval '30 days'`, so an event exactly 30 days old no longer counts. An attempt is permanently recorded immediately before OpenRouter is called; successful replies and unusable model results both count. Rejections before provider dispatch do not. The endpoint returns HTTP 429 with `code: "usage_limit"` before calling Gemini once the cap is reached. The same cap applies to Weekly and Monthly subscribers.

The endpoint uses `claim_ai_generation_attempt_with_availability(is_onboarding)` to wrap the original claim RPCs in the same locked transaction. A blocked response includes `retryAt`, an ISO timestamp computed as the 500th newest active attempt plus 30 days (also correct above the cap). The app shows “Reply limit reached” with this time in the phone's timezone, rounded up to a minute, and a “Got it” button that dismisses the notice without requesting a reply. Missing or invalid timestamps use a generic limit message. Deploy the availability migration before the updated edge function, then update/reload the app; the original RPCs remain compatible with older functions.

The onboarding screenshot flow is separately limited to one provider dispatch per anonymous user. Its atomic claim permanently records both the one-time onboarding marker and one normal generation attempt before OpenRouter is called. Repeating it returns HTTP 409 with `code: "onboarding_reply_used"` and never reaches Gemini.

The provider schema omits string length bounds and the large message-array bound, and uses Gemini's supported
nullable type form. The former bounded schema triggered Google `INVALID_ARGUMENT`
(HTTP 400); the live request succeeded after removing the provider-side 200-message array bound.
Runtime checks still enforce message/reply counts and text lengths on both boundaries.
