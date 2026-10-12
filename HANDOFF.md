# WiNGR engineering handoff

Updated 2026-10-12 on `experiment/compact-ai-output`. This branch is not merged
into `main` and contains experimental staging work. Do not treat it as a
production-release recommendation without the follow-up evaluation below.

## Current status

The compact AI-output implementation is the baseline on this branch. It returns
one `vibeCheck` and one reply rather than the prior expanded message-array
output. The benchmark safety/measurement tooling was strengthened, and a second
latency experiment was implemented behind the existing Edge Function behavior.

Completed work in the working tree:

- Hardened `scripts/benchmark-ai-output.ts`: exact fixture-name and image-signature
  validation, 45-second no-retry request deadline, response acceptance matching
  production (`stop`, non-refused, schema-valid JSON), input-token reporting and
  atomically refreshed ignored aggregate-only partial reports.
- Extended benchmark tests and `benchmarks/README.md` to describe those guards.
- Implemented the **lease-release latency experiment** in
  `supabase/functions/_shared/analyze-conversation.ts`. After a fully validated
  successful subscription reply, the database lease release is deferred via
  `EdgeRuntime.waitUntil` in `ai-conversation/index.ts`, so it is no longer on
  the response-critical path.
- Kept cleanup synchronous for onboarding, provider/validation failures and a
  missing background scheduler. A release failure remains safe because the
  existing 60-second database TTL recovers it.
- Added narrowly scoped lease-release telemetry. It logs only a fixed event
  name, duration, generation category and success/failure outcome—never an
  image, prompt, transcript, reply, user ID or secret.
- Updated backend privacy documentation accordingly.

The lease experiment was deployed to the known staging project before this
handoff; production was not deployed or modified. Manual phone smoke testing
through the staging Metro QR flow generated replies successfully. That verifies
the end-to-end happy path, but it is not yet a statistically useful latency
measurement.

## Measured compact-output A/B benchmark

An earlier, explicitly authorized direct staging-key benchmark made 18 requests
(three baseline and three compact requests for each of three consented fixtures).
Reports and fixtures remain ignored; the retained measurements are:

| Metric | Baseline | Compact | Change |
| --- | ---: | ---: | ---: |
| Median latency | 9,242.98 ms | 8,070.54 ms | **-12.68%** |
| P90 latency | 11,239.83 ms | 9,664.31 ms | **-14.02%** |
| Median input tokens | 2,161 | 2,062 | -4.58% |
| Median output tokens | 943 | 611 | **-35.21%** |
| Median reasoning tokens | 513 | 475 | -7.41% |

This supports retaining compact output as the benchmark baseline. It does not
prove the same percentage for all conversations or providers; fixtures were
limited to three consented screenshots.

## Current experiment and unfinished work

The deferred lease-release change is a controlled server-side latency experiment.
It should reduce end-to-end latency by removing one database RPC from the
successful subscription response path. Its actual benefit is not yet quantified.

Runtime verification is pending because Supabase function-log ingestion lagged
behind the manual staging traffic during the test session. Query only the
privacy-safe event `ai_generation_lease_release_latency` from `function_logs`;
do not broaden logging or inspect prompts/screenshots to troubleshoot it. Compare
the event's duration with end-to-end request timing only after enough successful
staging calls have accumulated.

No additional paid OpenRouter calls are authorized by this handoff. The next
live benchmark or extra test traffic needs explicit user approval and a stated
budget. `npm run benchmark:ai -- --dry-run` is safe to run without approval.

## Technical decisions and risks

- **Reasoning stays medium.** A previous low-reasoning setting harmed response
  quality. Do not repeat it without a blinded fixture review covering speaker
  ownership, cropped screenshots, language and reply usefulness.
- **No automatic screenshot cropping.** The fixture images are phone-sized and
  may be tiled by the vision provider. Cropping could reduce image processing
  cost, but risks removing the bottom/latest bubble and changing ME/THEM
  attribution. Measure it as a separately gated experiment with manual review.
- **Fallback behavior is deliberate.** The deferred cleanup applies only after
  valid paid/subscription output. Onboarding and failure paths remain synchronous
  so leases cannot be left active due to an unavailable scheduler.
- **Telemetry is privacy constrained.** Keep the exact four-field allowlist
  tested in `analyze-conversation.test.ts`; no request or response content
  belongs in latency logs.
- **Staging ambiguity.** The Supabase dashboard UI can show a `main` branch
  label even for the known staging project ref. Verify the project ref and URL,
  not only the visual label, before any future staging action.

## Recommended next steps

1. Let staging runtime logs settle, then inspect the fixed lease-release metric
   and Edge Function request timing for the manual test window. Record sample
   count and percentile definitions before interpreting a result.
2. If the lease release is reliably scheduled and benefits observed latency,
   run a bounded, user-approved staging comparison against the preserved compact
   baseline. Include failures and lease recovery checks—not just happy-path speed.
3. Perform manual fixture QA before any prompt/image experiment. For every
   fixture, record visible messages and ownership, the latest hook, language,
   expected reply direction and whether the screenshot is cropped at the bottom.
4. Candidate future experiments, one at a time: prompt-token reduction that
   leaves output schema and medium reasoning intact; safe image downscaling or
   crop proposals evaluated offline; provider/network timing attribution. Do not
   change multiple variables in one run.
5. Before any production decision, repeat tests, perform an independently
   reviewed fixture-quality pass and obtain explicit approval for deployment.

## Validation to run before handoff commit

```sh
npm test
npm run typecheck
npm run benchmark:ai -- --dry-run
git diff --check
```

The first two cover app and shared Edge Function behavior; the dry run validates
the benchmark fixtures without reading credentials or making a network request.

## Update 2026-10-12 (Claude review)

- Independent review of the deferred lease release found no defects: quota is
  recorded at claim (not release), release is lease-id scoped under the same
  advisory lock, failures/timeouts are swallowed and recovered by the 60-second
  TTL. Only new effect: an immediate re-request can briefly see
  `generation_in_progress` (no quota consumed).
- Added a test for a failing deferred release and `npm run staging:latency`
  (`scripts/staging-latency-report.ts`): offline, no network/credentials/quota.
  Next: export staging `function_logs` for the lease event and run it with
  `--logs`; only then consider an approved, budgeted A/B using `--samples`.

## Latency investigation (Claude, 2026-10-12)

Measured on staging (12 successful subscription requests): provider median
8.9 s / P90 14.1 s; lease release median 66 ms (0.7%). Fixtures are 0.3-0.5 MB
PNGs, so upload/compression is a minor cost and image downscaling is not worth
its quality risk. Remaining critical path before the model call is sequential:
auth -> body read -> RevenueCat (2 calls for subscribers) -> claim RPC.

Rejected on purpose: starting RevenueCat verification before the body is read
or fetching entitlements/subscriptions in parallel. Existing tests pin that
invalid/oversized requests reject before RevenueCat and that subscriptions are
not read without Pro; keep those guarantees unless the product owner decides
otherwise. Added `ai_generation_stage_latency` telemetry (fixed numeric fields)
so the next staging run shows body/entitlement/claim/provider/total per request;
`npm run staging:latency` summarizes it. Deploy to staging requires approval.

## Offline experiments (Claude, 2026-10-12)

Telemetry deployed to staging only (`--project-ref driytnlagwgzebnfdpcr`; the CLI
link in `supabase/.temp` still points at the production-labelled project, so
never deploy without an explicit ref).

- Screenshot resolution: `npm run experiment:image-resolution` (macOS sips +
  Vision OCR, aggregate-only, no AI call). 3 fixtures: 1170x2532 PNG, ~0.5 MB
  base64. 1280px long edge PNG: ~0.25 MB, OCR word recall 99-100%. Saves
  ~0.25 MB of upload; provider image tokens likely capped, so latency gain is
  expected to be small. Needs a client image-resize dependency. OCR recall
  cannot judge ME/THEM ownership.
- Prompt: `benchmarks/prompt-candidates.ts` holds a lean candidate (-7.4%, about
  65 tokens) guarded by a 37-rule checklist that the production prompt also
  passes (`scripts/prompt-candidates.test.js`). Not wired into production or the
  benchmark; any live comparison needs approval and fixture-based review.

## Image-resolution A/B result (staging key, 18 paid calls, 2026-10-12)

Original (1170x2532 PNG) vs 1280 px long edge, 3 fixtures x 3 runs each, compact
baseline, everything else identical. Input tokens were exactly 2,062 for every
run of both variants: Gemini 3 allocates a fixed per-image budget (1,120 tokens
by default), so resizing does not reduce billed or processed image tokens.
Median latency 8,136 -> 7,248 ms (-10.9%) but P90 9,503 -> 10,521 ms (+10.7%);
output/reasoning-token differences are within run-to-run noise at n=9 per arm.
Conclusion: no evidence of benefit; do not add a client resize dependency on
this basis. A local-only review file with model output (ignored by Git) exists in
benchmarks/results/ and was NOT read; delete it when no longer needed.

## Reasoning-effort A/B (prepared, not run)

`npm run benchmark:reasoning-effort` (dry run by default) compares medium vs low on
the original fixtures with identical prompt/contract/Vertex-only/ZDR routing; the
request contract is asserted before every call. Blinded manual review and scoring
are documented in `benchmarks/README.md`. No paid call was made. Stage telemetry
analysis was blocked: the only local log export predates the telemetry deploy
(0 `ai_generation_stage_latency` events).

## Reasoning-effort A/B result: medium vs low (18 paid calls, 2026-10-12)

3 fixtures x 3 runs, original resolution, identical prompt/contract/Vertex-only/ZDR.
Medium: 8 valid + 1 validation error, median 9,655 ms, P90 33,355 ms (above the
25 s production AI timeout), 496 median reasoning tokens. Low: 9/9 valid, median
3,289 ms (-66%), P90 5,324 ms, 0 reasoning tokens (low effectively disables
thinking on this model via OpenRouter), 145 median output tokens. Enum agreement 1.0
across variants; reply length equal.

Blinded first-pass review by Claude (8 medium/low pairs, scored before unblinding;
not a human review): no ownership, language or cropped-bubble failures in either
variant; hook 4.25 vs 4.25; naturalness medium 4.0 vs low 3.75; preferences
medium 4, low 2, tie 2. Both variants invented personal facts (favorite game,
weekend plans) on one fixture in 3/3 outputs each - a prompt issue independent of
reasoning. Limits: 3 easy fixtures (clear bubble colors), n=8 pairs, AI reviewer.
Low is NOT approved for production; it needs a larger, harder fixture set
(ambiguous ownership, same-color bubbles, cropped bottoms, mixed languages) and a
human blinded review first. Local review/scores/key files stay ignored in
benchmarks/results/.

## Low-reasoning follow-ups (Claude, 2026-10-12)

- Blinded review page: `npm run review:blind-page` (local-only, see benchmarks/README.md).
- OpenRouter model metadata for `google/gemini-3.8-flash` (public /models endpoint, no
  paid call): reasoning is mandatory (cannot be disabled), `supported_efforts` =
  high/medium/low, default medium, no max_tokens reasoning-budget support listed.
  OpenRouter docs: Gemini 3 uses Google's thinkingLevel; `effort` passes through, and a
  `reasoning.max_tokens` would only be mapped to a level, so there is no true token-budget
  middle ground. Pricing: $0.75/M input, $3.75/M output (reasoning billed as output).
- Fact-grounding prompt candidate (`withFactGrounding` in benchmarks/prompt-candidates.ts,
  tested, NOT in production) targets replies that state ME's favorites/plans/willingness
  that the screenshot never establishes. Needs an approved live A/B before any change.

## Human blinded review of medium vs low (owner, 2026-10-12)

8 pairs scored blind in the local review page (15 of 16 outputs rated; pair F1-1 output
B unrated; the "which would I send" choice was exported empty for all pairs). No
ME/THEM errors and no invented-facts flags (this differs from Claude's first pass,
which flagged the personal-fact answers on one fixture; the owner did not).
Means (1-5): hook low 4.86 / medium 4.88; naturalness low 4.29 / medium 4.63; flirt low
4.43 / medium 4.63. Pairwise on naturalness (7 comparable pairs): medium better in 3,
low better in 1, 3 ties. All three medium wins are on the Danish-language fixture
(naturalness low 3.3 vs medium 5.0); English fixtures were equal or favored low. Latency
benefit of low stays -66% (median 9.7 -> 3.3 s). Next: a larger fixture set with several
Danish conversations before any production decision.

Update: the owner completed the review (all 16 outputs rated). Means (1-5): hook low
4.75 / medium 4.88; naturalness low 4.25 / medium 4.63; flirt low 4.38 / medium 4.63.
Choices: medium 3, low 1, tie 3, one pair without a choice. No ME/THEM or
invented-facts flags. Pairwise naturalness: medium better in 3 pairs (all on the Danish
fixture), low better in 1, 4 ties. This supersedes the partial numbers above.

## Second human blinded round: medium vs low on 7 new English fixtures (2026-10-12)

Fixtures 04, 06, 08, 10, 11, 12, 13 (05/07/09 were byte-identical duplicates of 03/01/02
and were skipped), 2 runs per variant, 28 paid staging calls, original resolution, owner
scored 14 pairs blind. Speed: median 8,082 -> 3,733 ms (-54%), P90 11,666 -> 5,244 ms,
reasoning tokens 524 -> 0, no errors either side. Quality (1-5): hook low 4.93 / medium
4.86; naturalness 4.93 / 5.00; flirt 4.36 / 4.79 (medium better in 6 of 14 pairs, 8
ties, low never better on flirt). No ME/THEM or invented-facts flags. Choices: medium 5,
low 3, tie 4, none 2. Combined with round one (22 pairs): understanding/ownership is
equal; low costs about 0.4 flirt points on English and looked weaker on Danish
naturalness (only 3 pairs on one Danish fixture). Open: more Danish fixtures, hard
ownership cases, and whether a prompt tweak can recover flirt under low.

## Configurable reasoning effort (Claude, 2026-10-12; NOT deployed)

Primary market is English-speaking users, so the Danish naturalness concern is low
priority. `AI_REASONING_EFFORT` (Edge Function secret) now selects "low" or the default
"medium"; anything else falls back to medium. Only `reasoning.effort` changes (tested:
routing, model and contract identical). Stage telemetry records `reasoningEffort` and
`npm run staging:latency` splits timings by effort. Suggested staging validation: set
`AI_REASONING_EFFORT=low` on staging only (needs owner approval), use the app on a phone
for real flows, compare stage latency by effort and re-review replies; roll back by
unsetting the secret. Do not set it on production without a separate decision.

## Tasks 1 and 2 of the quality/performance plan (Claude, 2026-10-12; local only, not deployed)

**Task 2 (implemented locally):** `SYSTEM_PROMPT` now asks for the vibeCheck text fields
(conversationEnergy, risk, summary) to be written directly to the user in second person, like
a short note from a friend (you/your/you both; they/their/THEM's name), never using ME, THEM,
"the user" or report openings ("Both agreed...", "The conversation shows..."), without
overstating interest or inventing details; the reply stays in ME's voice. One paragraph added;
JSON schema, parser and sender-identification rules are unchanged (`prompting.test.ts`,
`scripts/vibe-voice-lint.ts` + tests; the lint is offline-only and never alters a response).
Previously 0/28 summaries in round two used ME/THEM labels, 16/28 addressed the reader.

**Task 1 (candidate only):** `withFlirtTone` in `benchmarks/prompt-candidates.ts` rewrites only
the tone paragraph (one specific detail THEM gave -> gentle tease/callback/small challenge,
self-aware humor, subtle, no generic compliments/pickup lines, one or two short sentences,
light hook; direct and casualSmallTalk unchanged). Basis: the six pairs where Medium scored
higher on flirt (F4-2, F6-1, F10-2, F11-1 English; F12-1/F12-2 are Danish - fixtures 12 and 13
are Danish, not English). Medium turned a concrete detail into a tease or small challenge,
added self-aware humor and stayed punchy; Low answered correctly but more logistically.
Planned blinded A/B (not run): A = medium + current prompt, B = low + flirt-tone, English
fixtures 1,3,4,6,8,10,11 x 2 runs = 28 paid calls (about $0.08), 14 pairs. Both arms include
the Task 2 vibe rule, so voice shares are measured in the same run.

## Blinded A/B: Medium + current prompt vs Low + flirt-tone prompt (owner, 2026-10-12)

English fixtures 1,3,4,6,8,10,11 x 2 runs, 28 paid staging calls, 13 complete pairs (one
Medium validation error). Both arms include the personal-vibe rule. Owner scores (1-5):
flirt Medium 4.62 / Low 3.69 (Medium better in 8 pairs, tie 4, Low 1); naturalness 4.77 /
4.77; context 4.92 / 5.00; vibe check quality 4.62 / 4.92; ME/THEM errors 0/0; invented facts
0/0; vibe checks that speak directly to the reader 13/13 in BOTH arms; ME/THEM labels or
report tone 0/0. Choices: Medium 9, Low 2, tie 2.
Conclusion: the flirt-tone prompt did NOT recover flirt under Low (on fixtures 4,6,8,10,11 the
gap is about 0.9 now vs 0.4 for Low + old prompt in round two - not a controlled comparison:
different generations, old prompt had no vibe rule, n about 9-10 per cell). Low replies tended
to end in a plain logistical question instead of a teasing hook. The personal-vibe prompt works
(direct address 26/26 outputs, no internal labels).
Speed: median 8,964 ms Medium vs 3,979 ms Low (-56%); median input tokens 2,230 vs 2,325
(+95 for the longer Low prompt, negligible prefill); Low output tokens unchanged (about 145).
Low P90 was 24.7 s (two slow outliers) vs 12.6 s Medium; earlier Low rounds had P90 about 5 s, so
this looks like provider tail variance rather than the prompt, but it is unverified. Medium
produced 1 validation error in this round (2 of 37 Medium vs 0 of 37 Low across three rounds).
One Medium vibe check was written in Danish for a conversation whose latest exchange was English
(rated 1): a mixed-language edge case.
Next candidates: Low + existing prompt as a control on the same fixtures; choose effort by
selected tone (Medium for playful, Low for direct/casualSmallTalk) after testing those tones.

## Decision: Low reasoning is the default; flirt-tone experiment dropped (2026-10-12; local, not deployed)

`DEFAULT_REASONING_EFFORT` is now "low"; `AI_REASONING_EFFORT=medium` switches back, anything
else means low (tests cover default, switch, routing/model/contract pinning and telemetry).
The experimental flirt-tone prompt (candidate, benchmark option and tests) was removed; the
current tone instruction is unchanged. The personal vibe check rule stays. Production, staging
and secrets were NOT touched; nothing is deployed.

## Investigations (Claude, 2026-10-12; no new paid calls, nothing deployed)

**Slow Low calls (P90 24.7 s, round three).** Raw per-run data was never stored, so the cause cannot
be identified from existing logs. What the aggregates show: P90 of 14 = the 13th value, so at least
2 of 14 Low runs took 24.7 s or more; Low P90 was about 5 s in the two earlier rounds; the same round's
Low median output tokens (144.5) and reasoning tokens (0) were normal. Slow tails also appear
with Medium (benchmark P90 33.4 s in round one, app traffic max 23.2 s of 12 calls). So roughly 3-4%
of about 110 calls across both efforts exceeded 23 s: this looks like provider/queue tail variance
rather than an effort or prompt effect (unverified). Diagnostics added: the reasoning benchmark JSON now
records per-run numbers only (latency, tokens, finish reason, start time, status). Mitigation to
discuss (not implemented): a hedged retry after about 10 s inside the same lease (no extra quota).

**Language mix.** Across all 70 benchmark outputs only 1 mixed English reply with Danish vibe
fields (fixture 1, Medium: Danish opener and Danish app UI, latest exchange English). The current
prompt handles reply and vibe text in separate sentences. Candidate (not in production):
`withUnifiedLanguage` in benchmarks/prompt-candidates.ts - ONE language per response from the latest
meaningful exchange, applied to the reply and conversationEnergy, risk and summary. The benchmark
now reports a heuristic `mixedLanguageShare`. The review page showed "Energi"/"Risiko" because those
were my hard-coded Danish labels in the page; the app itself uses "Conversation energy" and "Risk".
Fixed to the app's English labels.

**Fixture coverage.** Seven English fixtures are only four distinct conversations (1, 6, 8 are one
Alex chat at three scroll positions; 10 and 11 are one Kevin chat; 3 is Erik; 4 is Alex drinks);
2, 12 and 13 are Danish; 5, 7 and 9 are byte-identical duplicates. Covered: cropped bottom bubble
(1, 10), teasing/indirect flirt, clear interest, ME-latest message (10). Missing: unclear ownership,
same-coloured bubbles, other apps and dark mode, sarcasm, very short/ambiguous replies, low or mixed
interest, sensitive/negative messages, image/GIF/voice-only last item, reply threads, unreadable
screenshot. Proposed new fixtures are listed in the owner conversation; see also
STAGING_VALIDATION_LOW_REASONING.md for the staging plan and the local environment verification.
