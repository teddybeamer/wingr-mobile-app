begin;
select no_plan();
set local session_replication_role = replica;

select has_table('public', 'ai_generation_leases', 'generation leases are persisted');
select col_type_is('public', 'ai_generation_leases', 'user_id', 'uuid', 'lease user IDs are UUIDs');
select col_type_is('public', 'ai_generation_leases', 'lease_id', 'uuid', 'lease tokens are UUIDs');
select col_type_is('public', 'ai_generation_leases', 'expires_at', 'timestamp with time zone', 'lease expiration is timezone-aware');

create temporary table lease_test_state (
  name text primary key,
  lease_id uuid not null
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000401', true);
with claim as (
  select public.begin_ai_generation() as value
)
insert into lease_test_state (name, lease_id)
select 'first', (value->>'leaseId')::uuid from claim;

select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'an allowed lease inserts one generation attempt'
);
select ok(
  (select expires_at from public.ai_generation_leases where user_id = auth.uid())
    between clock_timestamp() + interval '59 seconds'
        and clock_timestamp() + interval '60 seconds',
  'the lease TTL is 60 seconds'
);
select is(
  public.begin_ai_generation()->>'status',
  'generation_in_progress',
  'an unexpired lease rejects a second generation'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'an active-lease rejection does not insert an attempt'
);

update public.ai_generation_leases
set expires_at = now() - interval '1 second'
where user_id = auth.uid();

with claim as (
  select public.begin_ai_generation() as value
)
insert into lease_test_state (name, lease_id)
select 'renewed', (value->>'leaseId')::uuid from claim;

select isnt(
  (select lease_id from lease_test_state where name = 'first'),
  (select lease_id from lease_test_state where name = 'renewed'),
  'an expired lease is replaced with an unpredictable new token'
);
select is(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'first')
  ),
  false,
  'a stale token cannot release a newer lease'
);
select is(
  (select lease_id from public.ai_generation_leases where user_id = auth.uid()),
  (select lease_id from lease_test_state where name = 'renewed'),
  'the newer lease survives a stale release'
);
select is(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'renewed')
  ),
  true,
  'the current token releases its own lease'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 499);
with claim as (
  select public.begin_ai_generation() as value
)
insert into lease_test_state (name, lease_id)
select 'attempt-500', (value->>'leaseId')::uuid from claim;
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  500::bigint,
  'the guarded claim can become attempt 500'
);
select ok(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'attempt-500')
  ),
  'attempt 500 lease releases normally'
);
select is(
  public.begin_ai_generation()->>'status',
  'usage_limit',
  'the guarded claim preserves the existing 500-attempt cap'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  500::bigint,
  'a usage-limit rejection does not insert an attempt'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000403', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '2 days' from generate_series(1, 500);
select is(
  public.begin_ai_generation()->>'status',
  'usage_limit',
  'a user already at 500 cannot acquire a lease'
);
select is(
  (select count(*) from public.ai_generation_leases where user_id = auth.uid()),
  0::bigint,
  'a usage-limited user has no lease row'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000404', true);
with claim as (
  select public.begin_ai_generation() as value
)
insert into lease_test_state (name, lease_id)
select 'normal-before-onboarding', (value->>'leaseId')::uuid from claim;
select is(
  public.begin_ai_generation(true)->>'status',
  'generation_in_progress',
  'normal and onboarding generation share one concurrency guard'
);
select is(
  (select count(*) from public.onboarding_ai_reply_claims where user_id = auth.uid()),
  0::bigint,
  'an onboarding concurrency rejection does not consume the one-time claim'
);
select ok(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'normal-before-onboarding')
  ),
  'the normal lease releases before onboarding'
);
with claim as (
  select public.begin_ai_generation(true) as value
)
insert into lease_test_state (name, lease_id)
select 'onboarding', (value->>'leaseId')::uuid from claim;
select is(
  (select count(*) from public.onboarding_ai_reply_claims where user_id = auth.uid()),
  1::bigint,
  'onboarding still consumes its one-time claim only when allowed'
);
select ok(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'onboarding')
  ),
  'the onboarding lease releases normally'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000405', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 124);
with claim as (
  select public.begin_ai_generation(false, 'weekly') as value
)
insert into lease_test_state (name, lease_id)
select 'weekly-attempt-125', (value->>'leaseId')::uuid from claim;
select is(
  (
    select count(*)
    from public.ai_generation_attempts
    where user_id = auth.uid()
      and attempted_at > now() - interval '7 days'
  ),
  125::bigint,
  'the guarded Weekly claim can become attempt 125'
);
select ok(
  public.release_ai_generation_lease(
    (select lease_id from lease_test_state where name = 'weekly-attempt-125')
  ),
  'attempt 125 Weekly lease releases normally'
);
select is(
  public.begin_ai_generation(false, 'weekly')->>'status',
  'usage_limit',
  'the guarded Weekly claim rejects attempt 126'
);
select is(
  (select count(*) from public.ai_generation_leases where user_id = auth.uid()),
  0::bigint,
  'a Weekly usage-limited user acquires no lease'
);

select ok(
  has_function_privilege('authenticated', 'public.begin_ai_generation(boolean)', 'execute'),
  'authenticated users can begin a guarded generation'
);
select ok(
  has_function_privilege('authenticated', 'public.begin_ai_generation(boolean, text)', 'execute'),
  'authenticated edge-function callers can begin a plan-specific generation'
);
select ok(
  not has_function_privilege('anon', 'public.begin_ai_generation(boolean)', 'execute'),
  'unauthenticated callers cannot begin a guarded generation'
);
select ok(
  not has_function_privilege('anon', 'public.begin_ai_generation(boolean, text)', 'execute'),
  'unauthenticated callers cannot begin a plan-specific generation'
);
select ok(
  has_function_privilege('authenticated', 'public.release_ai_generation_lease(uuid)', 'execute'),
  'authenticated users can release their own lease token'
);
select ok(
  not has_function_privilege('anon', 'public.release_ai_generation_lease(uuid)', 'execute'),
  'unauthenticated callers cannot release a lease'
);

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  'select public.begin_ai_generation()',
  '42501',
  'An authenticated user is required.',
  'begin requires a user identity'
);
select throws_ok(
  $$select public.release_ai_generation_lease('00000000-0000-4000-8000-000000000999')$$,
  '42501',
  'An authenticated user is required.',
  'release requires a user identity'
);

select * from finish();
rollback;
