# Wingr screenshot analysis

The app sends the original selected PNG/JPEG/WebP screenshot to `POST /ai-conversation`.
One Gemini 3.8 Flash request through OpenRouter reads the conversation, attributes ME/THEM,
assesses the vibe and generates one reply in the selected tone and conversation language.
The initial result supplies both the vibe card and reply card. Explicit refreshes use the same
endpoint with the original screenshot, tone and context. Images are not resized or reconstructed.

## Configuration

- Backend secrets/configuration (see `functions/.env.example`):
  - `OPENROUTER_API_KEY`.
  - `APPLE_DEVICECHECK_ENVIRONMENT`: `development` for development builds and
    `production` for TestFlight and App Store builds.
  - `APPLE_DEVICECHECK_TEAM_ID`, `APPLE_DEVICECHECK_KEY_ID`, and
    `APPLE_DEVICECHECK_PRIVATE_KEY`: the Apple DeviceCheck key material. Keep
    the PEM private key in a Supabase secret (including its line breaks), never
    in app configuration.
  - `ONBOARDING_TRIAL_RESULT_ENCRYPTION_KEY`: a unique base64-encoded 32-byte
    AES key, for example from `openssl rand -base64 32`. It encrypts the
    short-lived replay result and must not be changed while a 15-minute replay
    can still be active.
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
supabase secrets set REVENUECAT_V2_SECRET_API_KEY='replace-with-v2-secret' REVENUECAT_PROJECT_ID='proj_replace_me' REVENUECAT_PRO_ENTITLEMENT_RESOURCE_ID='entl_replace_me' REVENUECAT_WEEKLY_PRODUCT_RESOURCE_ID='prodcf6bb9dcdc' REVENUECAT_MONTHLY_PRODUCT_RESOURCE_ID='prodeb09795a02' APPLE_DEVICECHECK_ENVIRONMENT='production' APPLE_DEVICECHECK_TEAM_ID='replace-me' APPLE_DEVICECHECK_KEY_ID='replace-me' APPLE_DEVICECHECK_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nreplace-me\n-----END PRIVATE KEY-----' ONBOARDING_TRIAL_RESULT_ENCRYPTION_KEY='replace-with-32-byte-base64-key'
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

## Endpoint versions (read before deploying)

Two incompatible response contracts are live side by side. Each installed app build is
tied to the contract it validates, so **never redeploy or change `ai-conversation` while
WiNGR 1.0.0 (1) can still be installed.**

| Endpoint | Source | Contract | Used by | Reasoning |
| --- | --- | --- | --- | --- |
| `ai-conversation` | `functions/ai-conversation`, `functions/_shared/*` (frozen) | includes `messages` | build 1 | `medium` (hard-coded) |
| `ai-conversation-v2` | `functions/ai-conversation-v2`, `functions/_shared_v2/*` | compact: `replyable`, `vibeCheck`, `replies` | build 2 | `low` default, `AI_REASONING_EFFORT=medium` overrides |

`_shared_v2` holds only the contract-specific code (result parser and schema, prompt,
provider request, handler). Authentication, RevenueCat verification, usage limits,
DeviceCheck onboarding trials, CORS and the single `ConversationError` class are reused
unchanged from `_shared`, and both endpoints use the same project secrets and database.
The v2 endpoint needs no new secret. `AI_REASONING_EFFORT` is optional; leave it unset to
use `low`. Deploy v2 with an explicit project ref and never with a bare `deploy`:

```sh
supabase functions deploy ai-conversation-v2 --project-ref <verified-project-ref>
```

Retire v1 only after builds that call it are no longer in use.

## Contract

The description below is the v1 contract. v2 returns the same fields without `messages`.

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

### What counts as an attempt (`ai-conversation-v2`)

`ai-conversation-v2` charges a generation when it is settled, not when it starts
(migration `20261020140000_ai_generation_settlement.sql`, additive; the functions
above, and therefore `ai-conversation`, are unchanged and still charge at claim
time):

- `reserve_ai_generation(subscription_plan)` checks the plan limit against settled
  attempts and takes the same per-user 60-second lease. It charges nothing.
- `settle_ai_generation(lease_id, outcome)` ends the lease and applies the charge:
  - `success` — 1 attempt.
  - `failure` — 0 attempts. Provider errors, timeouts, invalid output, client
    aborts, and the rejections `ownership_unclear`, `no_replyable_message` and
    `unknown`.
  - `invalid_screenshot` — only `unreadable_image` and `no_conversation`. Every
    fifth one inside a 30-day window costs 1 attempt. The count
    (`ai_invalid_screenshot_counters`) persists across sessions, resets after the
    charge, and restarts once the first counted screenshot is 30 days old.

Deleting the lease is what authorizes the charge, under the per-user advisory lock,
and a unique index on `ai_generation_attempts.lease_id` backs it up, so a repeated
or concurrent settlement of one lease charges at most once. Settlement runs
synchronously, once, with a 3-second timeout and no retry. If it fails after a
valid reply, the reply is still returned and the user is not charged; the failure is
logged (`generation settlement failed`, fixed fields only) and the lease frees
itself within 60 seconds. Weekly (125 per 7 days), Monthly (500 per 30 days) and the
DeviceCheck onboarding preview, which never reserves or settles, are unchanged.
Apply the migration before deploying the updated function.

On iOS, onboarding uses Apple DeviceCheck bit 0 as the durable, one-preview-per-
iPhone marker. A client-created trial ID and a hash of the one-time DeviceCheck
token coordinate a 60-second single-flight lease; no permanent Wingr device ID
or token hash is retained. Gemini/provider failures, invalid output, cancellation,
and DeviceCheck lookup failures remove that lease without setting the bit or
creating an account claim. Once a schema-valid result exists, only its AES-GCM
encrypted derived output is retained for 15 minutes—never the screenshot—and the
server retries DeviceCheck finalization without calling Gemini again. After Apple
accepts bit 0, the same authenticated user and trial ID can replay that exact
result for the remaining window without creating another allowance. A minute-level
database cleanup job deletes expired result and transient metadata. A set device
bit without an active matching trial returns HTTP 409 with
`code: "onboarding_device_reply_used"`; the app explains the preview was used and
offers WiNGR Pro. Account deletion does not reset Apple’s device bit.

### Request outcome log (`ai-conversation-v2`)

Every POST writes exactly one `[Wingr AI] request outcome` line, including early
rejections that log nothing else (401, 403, 503, onboarding replay). Fields, all
closed values, a status or a duration:

| Field | Values |
|---|---|
| `category` | `ok`, `client_input`, `invalid_screenshot`, `quota`, `entitlement`, `authentication`, `provider`, `technical` |
| `code` | `ok`, the response `code` (`unusable_screenshot`, `usage_limit`, `subscription_required`, `timeout`, …) or `unknown` |
| `reason` | for `invalid_screenshot` only: `unreadable_image`, `no_conversation`, `ownership_unclear`, `no_replyable_message`, `unknown`; otherwise `null` |
| `status` | HTTP status (`500` if the handler threw) |
| `stage` | where it ended: `auth`, `body`, `entitlement`, `quota`, `provider`, `onboarding_trial`, `onboarding_replay`, `onboarding_finalize`, `done` |
| `generation` | `subscription`, `onboarding`, or `unknown` before the body is parsed |
| `durationMs` | whole request |

Categories: `client_input` is a malformed or oversized request, `entitlement` is
`subscription_required`, `authentication` is `unauthorized`, `quota` covers usage
limit, in-progress and onboarding-used, `provider` is the model call
(`provider`, `invalid_output`, `timeout`), and `technical` is a dependency that was
unavailable (RevenueCat, auth verification, DeviceCheck or the database). The line is
`info` for every answered request, because failures already warn through
`request failed` and `RevenueCat verification failed`; filter on `category`. An
unhandled exception is logged once at `error`. Preflight and non-POST requests are not
logged. Nothing from the request, response, user or lease is included.

A request that fails inside the app before it is sent (file too large, unsupported
format) never reaches the function and has no outcome line.

### Free onboarding reply on `ai-conversation-v2`

One free reply per device, and only a valid reply uses it. Provider errors,
timeouts, invalid output, unreadable or unusable screenshots, and Apple or database
errors before the reply is stored all abandon the trial without setting the
DeviceCheck bit or making the account claim, so the user can try again. The bit and
the claim are set only after a valid reply is stored.

`_shared_v2/onboarding-device-trial.ts` differs from the shared manager that
`ai-conversation` keeps using in three ways:

- The trial row is bound to `sha256(trial ID)` rather than to the hash of the
  DeviceCheck token. DeviceCheck issues a new token per request, so a retry carried a
  different hash and failed with “Trial does not belong to this device” for up to 15
  minutes whenever an interrupted request left its row behind. A retry now gets
  `generation_in_progress` until the 60-second lease ends, or its stored result.
- The free reply is not an attempt. Finalizing calls
  `finalize_onboarding_device_trial_v2` (migration
  `20261020150000_onboarding_trial_free_finalize.sql`), which makes the account claim
  but records no `ai_generation_attempts` row, so the reply never reduces the Weekly
  (125) or Monthly (500) allowance. The original function, which `ai-conversation`
  still calls, records an attempt as before. Attempts recorded by it for accounts
  that already onboarded are not rewritten.
- DeviceCheck is queried again just before the reply is stored, so a request that
  finishes after another request from the same device has already released its
  reply returns nothing (HTTP 409 `onboarding_device_reply_used`).

Concurrency: the database allows one generating row per trial, finalizing is
serialized per account, and the account claim is recorded once. One
residual case remains by design: DeviceCheck has no compare-and-set, so two
different accounts on one device whose replies are stored within the same
round trip can both pass the second lookup.

Android currently retains the prior account-scoped onboarding path. This DeviceCheck
flow requires deployment of `20260921120000_devicecheck_onboarding_trials.sql`,
the configured secrets above, the `ai-conversation` Edge Function, and a new iOS
native build containing the DeviceCheck bridge.

The provider schema omits string length bounds and the large message-array bound, and uses Gemini's supported
nullable type form. The former bounded schema triggered Google `INVALID_ARGUMENT`
(HTTP 400); the live request succeeded after removing the provider-side 200-message array bound.
Runtime checks still enforce message/reply counts and text lengths on both boundaries.
