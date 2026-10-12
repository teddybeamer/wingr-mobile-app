# Staging validation plan: Low reasoning on the iPhone

Status 2026-10-12: the Low-by-default code (commit d40abc4) was DEPLOYED to staging only (function
version 10); sections 3-4 (the measurements) have not been run. Every further deployment, secret
change or paid call needs the owner's explicit approval at the time. Staging project ref:
`driytnlagwgzebnfdpcr` ("WiNGR Mobile Staging"). **Never rely on the CLI link** in
`supabase/.temp`: it points to the production-labelled project `ogypfpwbeeelyxqcyjle`. Always
pass `--project-ref driytnlagwgzebnfdpcr`, and never run `supabase link`.

## 1. Is the phone really talking to staging? (verified locally on 2026-10-12)

- The installed app is a **Debug development build** (`ios` DerivedData has only
  `Debug-iphoneos`, no embedded `main.jsbundle`), so its JavaScript always comes from Metro.
  Native sources contain no Supabase project ref; the backend URL is inlined into the JS bundle
  by Metro from environment variables.
- The Metro process that was running was `expo start --dev-client --clear`, started through
  `npm start` (the staging wrapper). Its served bundle contained exactly one WiNGR backend URL,
  `https://driytnlagwgzebnfdpcr.supabase.co/functions/v1`, and **zero** occurrences of the
  production ref. The repository `.env` contains the production ref, so a Metro started without
  the wrapper (for example plain `npx expo start`) would be unsafe.
- No separate staging build is needed, as long as the phone app is opened against a Metro started
  with `npm start`. A separate staging bundle id would only matter for keeping the App Store app
  installed side by side (it is overwritten today).

Re-check before every session (local only, no network beyond Metro):

```bash
npm run staging:check
curl -s "http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false" -o /tmp/b.js
grep -c driytnlagwgzebnfdpcr /tmp/b.js; grep -c ogypfpwbeeelyxqcyjle /tmp/b.js   # expect 1 and 0
rm /tmp/b.js
```

After the first generation, confirm in the dashboard (Edge Functions > ai-conversation >
Invocations) that a POST appears in the **staging** project.

## 2. Configure the effort in staging (needs approval)

Low is now the code default, so staging only needs the new code deployed:

```bash
supabase projects list                      # confirm driytnlagwgzebnfdpcr = WiNGR Mobile Staging
supabase functions deploy ai-conversation --project-ref driytnlagwgzebnfdpcr
```

Switch to Medium for the comparison block, and back:

```bash
supabase secrets set AI_REASONING_EFFORT=medium --project-ref driytnlagwgzebnfdpcr
supabase secrets list --project-ref driytnlagwgzebnfdpcr     # names and digests only
supabase secrets unset AI_REASONING_EFFORT --project-ref driytnlagwgzebnfdpcr   # back to low
```

Secrets are read when a function instance boots, so warm instances may keep the old value for a
while. Do not trust the command: confirm the active effort from the first stage-latency log line
(`reasoningEffort`) of each block, and discard generations from before it changed.

## 3. Measuring Low vs Medium

- Use the same 5-10 own/consented screenshots in each block and the same tone. Order:
  Low block, Medium block, Low block (about 10 generations each) to expose drift.
- Server side: `ai_generation_stage_latency` (bodyMs, entitlementWaitMs, claimMs, providerMs,
  totalMs, reasoningEffort) and `ai_generation_provider_latency`.
- Read the logs: Edge Functions > ai-conversation > Logs, last 1-3 hours, search `stage latency`
  (ingestion lags 1-5 minutes), download the CSV, then:

```bash
npm run staging:latency -- --logs ~/Desktop/<export>.csv
```

  It prints count, min, median, P90 and max per stage and splits by reasoning effort. P90 needs at
  least 10 samples per effort.
- Client perceived time (optional): screen-record the phone and time tap to reply.

## 4. Risks and mitigations

- **Wrong environment**: only `npm start`; run the checks in section 1; never run `supabase link`.
- **Quota and cost**: each generation consumes the staging test user's plan quota (125/week on
  Weekly) and a paid OpenRouter call (about $0.002-0.004). Budget the number of generations first.
- **Privacy**: only own or consented screenshots; the staging function keeps Vertex-only/ZDR and
  logs only fixed fields.
- **Tail latency**: about 3-4% of calls across both efforts took over 23 s; production's timeout is
  25 s and a timed-out call still consumes the attempt. Watch P90/max in the logs.
- **Secret lag / stale instances**: verify the active effort from the log, not from the command.
- **Debug build needs Metro**: the app does not open its JS without it; do not reinstall a Release
  build for this test (a Release bundle would embed whatever env existed at build time).
- **Rollback**: `supabase secrets unset AI_REASONING_EFFORT ...`; production is never touched.
