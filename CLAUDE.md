# WiNGR — Claude Code guide

Read and follow [AGENTS.md](AGENTS.md) first. In particular, before changing
Expo code, read the exact Expo SDK 56 documentation it links to. This file is
project context; it does not replace repository instructions.

## Project map

WiNGR is an Expo/React Native iOS app that turns a user-selected conversation
screenshot into a vibe check and suggested reply.

- `App.tsx`, `components/`, `onboarding/`, and `hooks/useConversationFlow.ts`
  implement the app flow.
- `lib/wingr-ai.ts` and `lib/wingr-api.ts` prepare and send the client request.
- `supabase/functions/ai-conversation/index.ts` is the authenticated Edge
  Function entrypoint.
- `supabase/functions/_shared/analyze-conversation.ts` owns request validation,
  entitlement/usage gating, the OpenRouter/Gemini call, response validation and
  lease cleanup. `openrouter.ts` contains model, provider and reasoning policy.
- `supabase/functions/_shared/usage-limit.ts` and `supabase/migrations/` enforce
  plan-specific limits and a generation lease. RevenueCat verification,
  DeviceCheck onboarding and account deletion also remain server-side.
- `benchmarks/` contains the compact-output A/B harness. Its consented image
  fixtures, local staging key and all result reports are intentionally ignored.

The normal API response contract is compact: one `vibeCheck` plus one reply.
Do not restore the old message-array output without a separately measured and
reviewed product decision.

## Everyday commands

```sh
npm test
npm run typecheck
npm run staging:check
npm run start:staging
npm run benchmark:ai -- --dry-run
```

`start`, `start:dev-client` and `start:staging` all use
`scripts/with-staging-env.js`. They require the ignored `.env.staging.local`
and force the staging Supabase Functions URL while disabling Expo's automatic
loading of the repository `.env`. Use a development build and the Metro QR code
on a phone. A backend-only Edge Function deployment is picked up by an already
running client; changing client JavaScript requires reloading/reopening the app.

The optional database concurrency integration test is
`npm run test:db-concurrency`; it needs a deliberately configured local
Supabase environment. When Deno is available, also run:

```sh
deno check supabase/functions/ai-conversation/index.ts
```

## Environments and deployment boundaries

- Staging project ref is `driytnlagwgzebnfdpcr`; the staging Functions base URL
  is hard-coded as a guard in `scripts/with-staging-env.js`.
- Treat `main` and all production EAS/Supabase configuration as production.
  Never infer that a project/dashboard label makes a deployment safe.
- Do not deploy, push migrations, set secrets, rotate keys or merge into `main`
  unless the user explicitly authorizes that exact action.
- Never put keys, tokens, screenshots, prompts, transcripts, model outputs or
  generated benchmark reports in Git, logs, issues or chat. Check
  `git status --ignored` around benchmark work if needed.

## AI, privacy and quality constraints

- Provider routing is intentionally pinned to Google Vertex through OpenRouter,
  with ZDR/data-collection protections and no fallback. Do not loosen those
  settings to diagnose latency or availability.
- Reasoning defaults to `low` (owner decision 2026-10-12, speed priority, backed by
  blinded benchmarks: near-identical context/naturalness, about 0.4 lower flirt, 54-66%
  faster). `AI_REASONING_EFFORT=medium` switches back. Do not change the default or add
  other effort levels without a controlled blinded evaluation. An early low-reasoning
  experiment (before the benchmark harness) had regressed quality.
- Screenshot ownership (ME vs THEM), cropped bottom bubbles, language and
  grounded replies are quality-critical. Do not add heuristic speaker
  reassignment or automatic screenshot cropping without fixture-based review.
- The live benchmark makes paid OpenRouter calls only with both `--execute` and
  `BENCHMARK_CONFIRM_LIVE_API=yes`, using an ignored staging-only key. A dry run
  is safe and makes no network request.
- Observe the response parser and database lease semantics when editing the AI
  path. Failure, onboarding and unavailable background scheduling must retain
  safe synchronous cleanup/fail-closed behavior.

## Working discipline

Inspect the working tree before editing; existing changes may be intentional.
Keep experiments individually attributable, add tests for behavior changes, run
the commands above, and document any incomplete experiment in `HANDOFF.md`.
`supabase/README.md` and `benchmarks/README.md` are the detailed operational
references for the backend and the benchmark respectively.
