# Compact-output benchmark

This benchmark compares the current compact response (`vibeCheck` and one reply)
against the pre-compact response (the same fields plus `messages`). The baseline
is loaded from the pinned Git object in `baseline.json`, so it cannot silently
drift with the working tree.

## Safety contract

- It makes no Supabase request and cannot create an anonymous user, claim an AI
  allowance, or consume a WiNGR user quota.
- It contacts OpenRouter directly only with both `--execute` and
  `BENCHMARK_CONFIRM_LIVE_API=yes`. Without both gates it performs no network
  call.
- Use a staging-only OpenRouter key in `benchmarks/.env.staging.local`. The
  script requires `BENCHMARK_ENVIRONMENT=staging` and the known staging
  Supabase project ref as a second guard.
- Screenshots and reports are ignored by Git. The script never prints, writes,
  or includes screenshot bytes, prompt text, model output, account data, API
  keys, or upstream response bodies in its report.

## Prepare the private fixtures

Save the three consented benchmark screenshots as exactly these files:

```text
benchmarks/screenshots/fixture-01.png
benchmarks/screenshots/fixture-02.png
benchmarks/screenshots/fixture-03.png
```

The runner requires valid PNG bytes and these exact three non-hidden filenames;
it stops if anything is missing, renamed, malformed, empty, or over 10 MiB. Do
not rename fixtures after a baseline/compact comparison has started.

## Review without an API call

```sh
npm run benchmark:ai -- --dry-run
```

This confirms the fixture count, image type and size, the pinned Git baseline,
and the planned alternating sequence. It neither reads credentials nor makes a
network request.

## Run after explicit approval

```sh
cp benchmarks/.env.staging.example benchmarks/.env.staging.local
# Add only the staging OpenRouter key to that ignored file.
BENCHMARK_CONFIRM_LIVE_API=yes npm run benchmark:ai -- --execute
```

For every fixture, the runner makes six direct OpenRouter requests: baseline,
compact, baseline, compact, baseline, compact. It alternates the first variant
between fixtures, giving three runs per variant per screenshot while reducing
ordering bias. It retains no generated content. The only output is an ignored,
aggregate JSON and Markdown report under `benchmarks/results/`.

The report uses median and nearest-rank P90 latency from valid responses. A
response is valid only when it has the same completed, non-refused shape that
production accepts. It reports median input, completion/output and reasoning
token counts, plus compact versus baseline savings when that token field is
supplied by the provider. Missing token fields are reported as `null`, never as
zero. Each direct request has a 45-second local timeout; the runner does not
retry it. During a live run, it atomically refreshes an ignored aggregate-only
`.partial` report after each completed request; a successful run replaces it
with the final report. This preserves completed aggregate measurements if the
process is interrupted without retaining screenshots, prompts, or model output.

## Offline staging latency report

`npm run staging:latency -- --logs <export> [--samples <file>]` summarizes latency
without any network access, credentials, generation request or quota use. `--logs`
takes a staging `function_logs` export (JSON array, `{result: []}`, NDJSON or text)
and reports `ai_generation_lease_release_latency` and
`ai_generation_provider_latency` as count/min/median/P90/max per generation and
outcome, plus the lease release as a share of provider latency. `--samples` takes
client-side NDJSON/JSON rows of `{"label": "...", "durationMs": 123}` for any
future end-to-end experiment and compares two labels' medians. P90 is withheld
below 10 samples. Only allowlisted numeric/enum fields are read; the script
refuses input that references a Supabase project other than the staging ref.
Keep exports and reports out of Git (they are not under `benchmarks/results/`
unless you put them there).

## Image-resolution A/B (original vs 1280 px)

`npm run benchmark:image-resolution` is a dry run: it resizes the ignored fixtures to
a 1280 px long edge in a temporary directory (aspect ratio verified, no cropping),
prints payload and pixel reduction, and makes no network request or credential read.
A live run needs `-- --execute` and `BENCHMARK_CONFIRM_LIVE_API=yes` plus the ignored
staging-only key, and makes 3 fixtures x 3 runs x 2 variants = 18 paid calls
(`--runs N`, 1-5). The request is built by the same production code for both variants,
so only the image differs. The aggregate report compares latency, tokens and
structured-output agreement (within-original agreement is the noise floor).
Add `--write-review` to also write an ignored, local-only side-by-side file of model
output for the manual checklist (ME/THEM ownership, short messages and emoji, cropped
bottom bubbles, language). Never share or commit it.

## Reasoning-effort A/B (medium vs low)

`npm run benchmark:reasoning-effort` is a dry run: it builds both requests with the
production code, asserts they differ only in `reasoning.effort`, and re-checks the
model, Vertex-only/ZDR routing and no-fallback settings (the same check runs before
every live request). It makes no network request. A live run needs `-- --execute`,
`BENCHMARK_CONFIRM_LIVE_API=yes` and the ignored staging-only key, and makes 3
fixtures x 3 runs x 2 variants = 18 paid calls (`--runs N`, 1-5). Production stays
on medium; a previous low-reasoning experiment regressed quality.

Add `--write-review` for a **blinded** manual review: it writes three ignored,
local-only files in `benchmarks/results/`: a review file with each medium/low pair
shown as A/B in random order, a scores template and a key. Score every output before
opening the aggregate report or the key: ownership (ME/THEM and perspective),
noInventedFacts, language (true/false) and hook, natural (1-5), plus small messages
and cropped bottom bubbles. Then unblind with
`npm run benchmark:reasoning-effort -- --score <key.local.json> <scores.local.json>`,
which prints per-variant totals without any model text. Never share or commit these
files.

## Blinded review page

`npm run review:blind-page` turns the latest `reasoning-effort-review-*.local.md` into
one self-contained, local-only HTML page in `benchmarks/results/` (screenshot next to
replies A/B, 1-5 ratings for naturalness, flirt and context, ME/THEM and
invented-facts flags, "which would you send"). It contains no variant key, makes no
network request and embeds consented screenshots and model output, so never share or
commit it. Export the scores from the page, then unblind with
`npm run benchmark:reasoning-effort -- --score <key.local.json> <exported-scores.json>`.

### Larger fixture sets (reasoning-effort benchmark)

The reasoning-effort benchmark accepts numbered fixtures `fixture-NN.png` (also jpg, jpeg,
webp). Byte-identical duplicates are skipped and reported by name, so a repeated screenshot
is never paid for twice. Use `--fixtures 4,6,8` to test a subset (for example only new
ones) and `--runs N` for runs per variant. The dry run prints the unique fixture numbers,
the number of paid calls, the blinded pairs to review and a rough cost estimate. Review
ids read `F<fixture number>-<run>`. The original compact-output and image-resolution
benchmarks stay pinned to fixtures 01-03.

### Flirt-tone candidate (Low reasoning)

`npm run benchmark:reasoning-effort -- --low-prompt flirt-tone` gives ONLY the Low variant the
flirt-adjusted tone paragraph from `benchmarks/prompt-candidates.ts` (Medium keeps the current
prompt). The dry run and every live request assert that the two requests differ in nothing but
`reasoning.effort` and that tone paragraph. The report adds the share of outputs with internal
`ME`/`THEM` labels or report-style openings (`scripts/vibe-voice-lint.ts`) and the share whose
summary addresses the reader.
