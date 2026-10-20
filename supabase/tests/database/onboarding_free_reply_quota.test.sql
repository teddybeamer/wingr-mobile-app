begin;

select plan(20);
set local session_replication_role = replica;

create temporary table ctx as
select
  '00000000-0000-4000-8000-000000000821'::uuid as legacy_user,
  '00000000-0000-4000-8000-000000000822'::uuid as weekly_user,
  '00000000-0000-4000-8000-000000000823'::uuid as monthly_user,
  '00000000-0000-4000-8000-000000000824'::uuid as failed_user,
  '00000000-0000-4000-8000-000000000825'::uuid as other_user,
  '00000000-0000-4000-8000-0000000008b1'::uuid as legacy_trial,
  '00000000-0000-4000-8000-0000000008b2'::uuid as weekly_trial,
  '00000000-0000-4000-8000-0000000008b3'::uuid as monthly_trial,
  '00000000-0000-4000-8000-0000000008b4'::uuid as failed_trial,
  '00000000-0000-4000-8000-0000000008b5'::uuid as other_trial,
  repeat('1', 64) as legacy_hash,
  repeat('2', 64) as weekly_hash,
  repeat('3', 64) as monthly_hash,
  repeat('4', 64) as failed_hash,
  repeat('5', 64) as other_hash;

create function pg_temp.attempts_of(who uuid) returns int
language sql as $$
  select count(*)::int from public.ai_generation_attempts where user_id = who
$$;
create function pg_temp.claims_of(who uuid) returns int
language sql as $$
  select count(*)::int from public.onboarding_ai_reply_claims where user_id = who
$$;
-- Runs one onboarding trial to a stored result, ready to finalize.
create function pg_temp.ready(who uuid, trial uuid, hash text) returns void
language plpgsql as $$
begin
  perform public.begin_onboarding_device_trial(who, trial, hash);
  perform public.store_onboarding_device_trial_result(who, trial, hash, 'cipher', 'iv');
end;
$$;

-- Permissions.
select ok(
  has_function_privilege('service_role', 'public.finalize_onboarding_device_trial_v2(uuid, uuid, text)', 'execute'),
  'the service role can finalize'
);
select ok(
  not has_function_privilege('authenticated', 'public.finalize_onboarding_device_trial_v2(uuid, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.finalize_onboarding_device_trial_v2(uuid, uuid, text)', 'execute'),
  'signed-in and anonymous callers cannot finalize'
);

-- The original function, kept for the original endpoint, still records an attempt.
select pg_temp.ready(legacy_user, legacy_trial, legacy_hash) from ctx;
select is(
  (select public.finalize_onboarding_device_trial(legacy_user, legacy_trial, legacy_hash)->>'status' from ctx),
  'finalized',
  'the original finalize still works'
);
select is(
  (select pg_temp.attempts_of(legacy_user) from ctx),
  1,
  'the original finalize is unchanged and still records one attempt'
);

-- v2: one claim, no attempt.
select pg_temp.ready(weekly_user, weekly_trial, weekly_hash) from ctx;
insert into public.ai_generation_attempts (user_id, attempted_at)
select weekly_user, now() - interval '1 day' from ctx, generate_series(1, 124);
select is(
  (select public.finalize_onboarding_device_trial_v2(weekly_user, weekly_trial, weekly_hash)->>'status' from ctx),
  'finalized',
  'v2 finalize releases the reply'
);
select is(
  (select pg_temp.claims_of(weekly_user) from ctx),
  1,
  'v2 finalize makes the one account claim'
);
select is(
  (select pg_temp.attempts_of(weekly_user) from ctx),
  124,
  'v2 finalize records no attempt, leaving a Weekly user at 124'
);
select is(
  (select public.finalize_onboarding_device_trial_v2(weekly_user, weekly_trial, weekly_hash)->>'status' from ctx),
  'replay',
  'finalizing again replays'
);
select is(
  (select pg_temp.claims_of(weekly_user) from ctx) + (select pg_temp.attempts_of(weekly_user) from ctx),
  125,
  'a replay adds neither a claim nor an attempt'
);

-- The Weekly allowance is intact: attempt 125 is still available, 126 is not.
select set_config('request.jwt.claim.sub', (select weekly_user::text from ctx), true);
create temporary table weekly_lease as
select public.reserve_ai_generation('weekly')->>'leaseId' as lease_id;
select is(
  (select lease_id is not null from weekly_lease),
  true,
  'a Weekly user can still reserve attempt 125 after the free reply'
);
select is(
  (select public.settle_ai_generation(lease_id::uuid, 'success')->>'charged' from weekly_lease),
  'true',
  'attempt 125 is charged normally'
);
select is(
  (select pg_temp.attempts_of(weekly_user) from ctx),
  125,
  'the Weekly user used exactly 125 paid attempts'
);
select is(
  (select public.reserve_ai_generation('weekly')->>'status'),
  'usage_limit',
  'attempt 126 is refused, so the limit is exactly 125 paid replies'
);

-- Monthly: 499 paid attempts, then the free reply, then attempt 500 is still allowed.
select pg_temp.ready(monthly_user, monthly_trial, monthly_hash) from ctx;
insert into public.ai_generation_attempts (user_id, attempted_at)
select monthly_user, now() - interval '1 day' from ctx, generate_series(1, 499);
select public.finalize_onboarding_device_trial_v2(monthly_user, monthly_trial, monthly_hash) from ctx;
select set_config('request.jwt.claim.sub', (select monthly_user::text from ctx), true);
create temporary table monthly_lease as
select public.reserve_ai_generation('monthly')->>'leaseId' as lease_id;
select is(
  (select lease_id is not null from monthly_lease),
  true,
  'a Monthly user at 499 can still reserve attempt 500 after the free reply'
);
select public.settle_ai_generation((select lease_id::uuid from monthly_lease), 'success');
select is(
  (select public.reserve_ai_generation('monthly')->>'status'),
  'usage_limit',
  'the Monthly limit is exactly 500 paid replies'
);

-- A failed onboarding generation is free: nothing recorded at all.
select public.begin_onboarding_device_trial(failed_user, failed_trial, failed_hash) from ctx;
select public.abandon_onboarding_device_trial(failed_user, failed_trial, failed_hash) from ctx;
select is(
  (select pg_temp.claims_of(failed_user) + pg_temp.attempts_of(failed_user) from ctx),
  0,
  'an abandoned onboarding generation records no claim and no attempt'
);

-- v2 finalize guards.
select is(
  (select public.finalize_onboarding_device_trial_v2(failed_user, failed_trial, failed_hash)->>'status' from ctx),
  'trial_unavailable',
  'a trial that was abandoned cannot be finalized'
);
select pg_temp.ready(other_user, other_trial, other_hash) from ctx;
select is(
  (select public.finalize_onboarding_device_trial_v2(other_user, other_trial, repeat('9', 64))->>'status' from ctx),
  'trial_unavailable',
  'finalizing with another binding finds nothing'
);
insert into public.onboarding_ai_reply_claims (user_id) select other_user from ctx;
select is(
  (select public.finalize_onboarding_device_trial_v2(other_user, other_trial, other_hash)->>'status' from ctx),
  'onboarding_reply_used',
  'an account that already has its free reply cannot finalize another'
);
select is(
  (select pg_temp.attempts_of(other_user) from ctx),
  0,
  'a refused finalization records no attempt either'
);

select * from finish();
rollback;
