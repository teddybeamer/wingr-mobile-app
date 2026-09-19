# Wingr screenshot analysis

The app sends the original selected PNG/JPEG/WebP screenshot to `POST /ai-conversation`.
One Gemini 3.8 Flash request through OpenRouter reads the conversation, attributes ME/THEM,
assesses the vibe and generates one reply in the selected tone and conversation language.
The initial result supplies both the vibe card and reply card. Explicit refreshes use the same
endpoint with the original screenshot, tone and context. Images are not resized or reconstructed.

## Configuration

- Backend secrets/configuration (see `functions/.env.example`):
  - `OPENROUTER_API_KEY`.
  - `REVENUECAT_V2_SECRET_API_KEY`: a RevenueCat v2 secret key restricted to
    `customer_information:customers:read` and
    `customer_information:subscriptions:read`. Never expose this key to the app
    or prefix it with `EXPO_PUBLIC_`.
  - `REVENUECAT_PROJECT_ID`: the RevenueCat project resource ID (`proj...`).
  - `REVENUECAT_PRO_ENTITLEMENT_RESOURCE_ID`: the RevenueCat entitlement
    resource ID (`entl...`) whose lookup key is exactly `pro`. This is not the
    literal `pro` lookup key; copy the internal resource ID from RevenueCat.
  - `REVENUECAT_WEEKLY_PRODUCT_RESOURCE_ID` and
    `REVENUECAT_MONTHLY_PRODUCT_RESOURCE_ID`: the trusted RevenueCat product
    resource IDs (`prod...`) used to classify an active Pro subscription.
- App: `EXPO_PUBLIC_WINGR_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1`.
- App identity: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Enable Anonymous Sign-Ins in Supabase Auth before deploying; the app creates and securely persists an anonymous session per installation.
- Model and 25-second provider deadline: `functions/_shared/openrouter.ts`.
- Reasoning: `reasoning: { effort: "medium" }`.
- Provider: standard Google Vertex only (`provider.only: ["google-vertex/global"]`,
  `service_tier: "default"`). Priority, Flex and other providers are excluded; no fallbacks.
- App network deadline: 35 seconds, including response body reads.
- Images: PNG/JPEG/WebP, at most 10 MB. Context: at most 4,000 characters.

Run locally with `supabase start` and `supabase functions serve --env-file supabase/functions/.env.local`
after configuring the secrets in an ignored local file. Configure the deployed
function and deploy it with:

```sh
supabase db push
supabase secrets set REVENUECAT_V2_SECRET_API_KEY='replace-with-v2-secret' REVENUECAT_PROJECT_ID='proj_replace_me' REVENUECAT_PRO_ENTITLEMENT_RESOURCE_ID='entl_replace_me' REVENUECAT_WEEKLY_PRODUCT_RESOURCE_ID='prodcf6bb9dcdc' REVENUECAT_MONTHLY_PRODUCT_RESOURCE_ID='prodeb09795a02'
supabase functions deploy ai-conversation
```

Create the RevenueCat key under Project settings > API keys as a v2 secret key.
Grant only `customer_information:customers:read` and
`customer_information:subscriptions:read`; the function does not need any write
permission. The endpoint reads the authenticated customer's `active_entitlements`
and `subscriptions`. It requires the configured active `pro` entitlement, then
classifies only access-granting subscriptions that include that entitlement by
their trusted RevenueCat product resource ID. The URL customer ID always comes
from the verified Supabase JWT subject.

This entitlement enforcement is server-only and does not require another native
app build. The existing RevenueCat client integration still requires a development
or native build as before.

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

For normal generations the server verifies the bearer JWT, validates the request,
checks RevenueCat for the authenticated Supabase UUID's active `pro` entitlement,
claims usage, and only then calls OpenRouter. A successful RevenueCat response
without the configured active entitlement returns HTTP 403 with
`code: "subscription_required"`. RevenueCat configuration, network, timeout,
authentication, authorization, rate-limit, and response-validation failures return
HTTP 503 with `code: "subscription_verification_unavailable"`. Neither response
claims usage or calls OpenRouter.

Weekly subscribers can dispatch 125 AI generation attempts in a rolling seven-day
window. Monthly subscribers retain 500 attempts in a rolling 30-day window. The
count uses a strict `attempted_at > now() - window` boundary, so an event exactly
seven or 30 days old no longer counts. Existing attempt history is retained and
interpreted with the currently verified subscription plan. An attempt is
permanently recorded immediately before OpenRouter is called; successful replies
and unusable model results both count. Rejections before provider dispatch do not.
The endpoint returns HTTP 429 with `code: "usage_limit"` before calling Gemini
once the applicable cap is reached.

`begin_ai_generation(is_onboarding, subscription_plan)` calls the plan-aware
availability claim in the same locked transaction. The plan comes only from the
server-side RevenueCat verification. Limits and windows are fixed in the database;
authenticated callers cannot provide arbitrary policy values. A blocked response
includes `retryAt`, computed as the applicable cap's newest boundary attempt plus
seven or 30 days. The app shows “Reply limit reached” with this time in the phone's
timezone, rounded up to a minute, and a “Got it” button that dismisses the notice
without requesting a reply. Missing or invalid timestamps use a generic limit
message. Deploy `20260919120000_plan_specific_ai_generation_limits.sql` before
the updated edge function; the original one-argument RPCs remain Monthly-compatible
for older deployed functions.

RevenueCat's current `product_id` and `gives_access` fields determine the plan;
pending product changes do not take effect early. If both configured products
simultaneously grant `pro`, the server chooses Weekly's stricter policy. An active
`pro` entitlement without a classifiable access-granting subscription fails closed
with `subscription_verification_unavailable` rather than receiving the Monthly cap.

`begin_ai_generation(is_onboarding)` adds a database-backed, per-user lease around
the existing atomic claim. Only one generation can be active for a Supabase user
across all Edge Function instances. The lease and attempt are created in the same
transaction immediately before OpenRouter dispatch. A concurrent request returns
HTTP 429 with `code: "generation_in_progress"`, a `Retry-After` header, and no new
attempt. The Edge Function releases the token-matched lease in `finally`; a failed
release cannot replace the provider response and recovers through the 60-second
lease expiration. Database or acquisition failures fail closed before OpenRouter.

The onboarding screenshot flow does not require `pro` and remains separately
limited to one provider dispatch per anonymous user. Its atomic claim permanently
records both the one-time onboarding marker and one normal generation attempt
before OpenRouter is called. Repeating it returns HTTP 409 with
`code: "onboarding_reply_used"` and never reaches Gemini.

The provider schema omits string length bounds and the large message-array bound, and uses Gemini's supported
nullable type form. The former bounded schema triggered Google `INVALID_ARGUMENT`
(HTTP 400); the live request succeeded after removing the provider-side 200-message array bound.
Runtime checks still enforce message/reply counts and text lengths on both boundaries.
