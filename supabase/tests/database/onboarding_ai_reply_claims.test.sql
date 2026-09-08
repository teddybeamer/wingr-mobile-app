begin;

select plan(5);

select has_table(
  'public',
  'onboarding_ai_reply_claims',
  'onboarding claims are persisted separately from UI state'
);

set local session_replication_role = replica;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000201', true);

select is(
  public.claim_onboarding_ai_generation_attempt(),
  'allowed',
  'the first onboarding request atomically claims the allowance'
);

select is(
  (select count(*) from public.onboarding_ai_reply_claims where user_id = '00000000-0000-0000-0000-000000000201'::uuid),
  1::bigint,
  'the onboarding allowance remains persisted after provider dispatch'
);

select is(
  (select count(*) from public.ai_generation_attempts where user_id = '00000000-0000-0000-0000-000000000201'::uuid and attempted_at > now() - interval '30 days'),
  1::bigint,
  'the onboarding claim also inserts one normal rolling-window attempt'
);

select is(
  public.claim_onboarding_ai_generation_attempt(),
  'onboarding_reply_used',
  'a second onboarding request is rejected without another model allowance'
);

select * from finish();
rollback;
