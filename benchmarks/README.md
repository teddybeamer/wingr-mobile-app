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

Only PNG, JPEG, and WebP are accepted. The directory must contain exactly three
non-hidden files; the runner stops otherwise. Do not rename fixtures after a
baseline/compact comparison has started.

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

The report uses median and nearest-rank P90 latency from valid responses. It
reports median completion/output and reasoning token counts, plus compact versus
baseline savings when that token field is supplied by the provider. Missing token
fields are reported as `null`, never as zero.
