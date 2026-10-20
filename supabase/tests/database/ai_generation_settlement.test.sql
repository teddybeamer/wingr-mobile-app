begin;
select no_plan();
set local session_replication_role = replica;

-- ---------------------------------------------------------------------------
-- Structure and permissions
-- ---------------------------------------------------------------------------
select has_column('public', 'ai_generation_attempts', 'lease_id', 'attempts record the lease they were charged for');
select col_is_null('public', 'ai_generation_attempts', 'lease_id', 'older callers may still insert attempts without a lease');
select has_index('public', 'ai_generation_attempts', 'ai_generation_attempts_lease_id_idx', 'a lease can be charged at most once');
select has_table('public', 'ai_invalid_screenshot_counters', 'invalid screenshot counters are persisted');
select col_type_is('public', 'ai_invalid_screenshot_counters', 'pending', 'smallint', 'the pending count is small');
select col_type_is('public', 'ai_invalid_screenshot_counters', 'window_started_at', 'timestamp with time zone', 'the counter window is timezone-aware');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_invalid_screenshot_counters'::regclass),
  'row level security is enabled on the counters'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_invalid_screenshot_counters', 'select')
  and not has_table_privilege('anon', 'public.ai_invalid_screenshot_counters', 'select')
  and not has_table_privilege('authenticated', 'public.ai_invalid_screenshot_counters', 'insert'),
  'callers cannot read or write the counters directly'
);
select ok(
  has_function_privilege('authenticated', 'public.reserve_ai_generation(text)', 'execute')
  and has_function_privilege('authenticated', 'public.settle_ai_generation(uuid, text)', 'execute'),
  'authenticated users can reserve and settle their own generation'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_ai_generation(text)', 'execute')
  and not has_function_privilege('anon', 'public.settle_ai_generation(uuid, text)', 'execute'),
  'unauthenticated callers can neither reserve nor settle'
);

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.reserve_ai_generation('monthly')$$,
  '42501',
  'An authenticated user is required.',
  'reserve requires a user identity'
);
select throws_ok(
  $$select public.settle_ai_generation('00000000-0000-4000-8000-000000000999', 'success')$$,
  '42501',
  'An authenticated user is required.',
  'settle requires a user identity'
);

-- ---------------------------------------------------------------------------
-- Reserve takes the lease and charges nothing
-- ---------------------------------------------------------------------------
create temporary table settle_state (name text primary key, lease_id uuid not null);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000601', true);
with reserved as (select public.reserve_ai_generation('monthly') as value)
insert into settle_state (name, lease_id)
select 'first', (value->>'leaseId')::uuid from reserved;

select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  0::bigint,
  'reserving a generation does not insert an attempt'
);
select ok(
  (select expires_at from public.ai_generation_leases where user_id = auth.uid())
    between clock_timestamp() + interval '59 seconds' and clock_timestamp() + interval '60 seconds',
  'the lease lasts 60 seconds'
);
select is(
  public.reserve_ai_generation('monthly')->>'status',
  'generation_in_progress',
  'an unexpired lease rejects a second reservation'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  0::bigint,
  'a rejected reservation charges nothing either'
);
select throws_ok(
  $$select public.reserve_ai_generation('yearly')$$,
  '22023',
  'Unsupported subscription plan.',
  'only the Weekly and Monthly plans can reserve'
);

-- ---------------------------------------------------------------------------
-- Success costs exactly one attempt, once
-- ---------------------------------------------------------------------------
select is(
  (public.settle_ai_generation((select lease_id from settle_state where name = 'first'), 'success'))->>'charged',
  'true',
  'a successful generation is charged'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'a successful generation costs exactly one attempt'
);
select is(
  (select lease_id from public.ai_generation_attempts where user_id = auth.uid()),
  (select lease_id from settle_state where name = 'first'),
  'the attempt records the lease it was charged for'
);
select is(
  (select count(*) from public.ai_generation_leases where user_id = auth.uid()),
  0::bigint,
  'settling ends the lease'
);
select is(
  public.settle_ai_generation((select lease_id from settle_state where name = 'first'), 'success')->>'status',
  'not_found',
  'settling the same lease again is a no-op'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'a repeated settlement never double charges'
);
select throws_ok(
  $$insert into public.ai_generation_attempts (user_id, lease_id)
    select auth.uid(), lease_id from settle_state where name = 'first'$$,
  '23505',
  null,
  'the database itself refuses a second charge for one lease'
);

-- ---------------------------------------------------------------------------
-- Technical failures cost nothing
-- ---------------------------------------------------------------------------
with reserved as (select public.reserve_ai_generation('monthly') as value)
insert into settle_state (name, lease_id)
select 'failed', (value->>'leaseId')::uuid from reserved;
select is(
  public.settle_ai_generation((select lease_id from settle_state where name = 'failed'), 'failure')->>'charged',
  'false',
  'a failed generation is not charged'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'a failed generation adds no attempt'
);
select is(
  (select count(*) from public.ai_generation_leases where user_id = auth.uid()),
  0::bigint,
  'a failed generation still frees the user to try again'
);
select throws_ok(
  $$select public.settle_ai_generation('00000000-0000-4000-8000-000000000999', 'refund')$$,
  '22023',
  'Unsupported settlement outcome.',
  'unknown outcomes are rejected'
);

-- ---------------------------------------------------------------------------
-- Every fifth invalid screenshot costs one attempt
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000602', true);
create temporary table invalid_charges (n integer primary key, charged boolean not null);
do $$
declare
  reserved jsonb;
  settled jsonb;
begin
  for i in 1..10 loop
    reserved := public.reserve_ai_generation('monthly');
    settled := public.settle_ai_generation((reserved->>'leaseId')::uuid, 'invalid_screenshot');
    insert into invalid_charges values (i, (settled->>'charged')::boolean);
  end loop;
end
$$;
select is(
  (select array_agg(n order by n) from invalid_charges where charged),
  array[5, 10],
  'only the 5th and 10th invalid screenshots are charged'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  2::bigint,
  'ten invalid screenshots cost two attempts'
);
select is(
  (select pending from public.ai_invalid_screenshot_counters where user_id = auth.uid()),
  0::smallint,
  'the count restarts after each charge'
);

do $$
declare
  reserved jsonb;
begin
  for i in 1..3 loop
    reserved := public.reserve_ai_generation('monthly');
    perform public.settle_ai_generation((reserved->>'leaseId')::uuid, 'invalid_screenshot');
  end loop;
end
$$;
select is(
  (select pending from public.ai_invalid_screenshot_counters where user_id = auth.uid()),
  3::smallint,
  'the count persists in the database between requests'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  2::bigint,
  'uncharged invalid screenshots add no attempt'
);

-- Successes and failures neither add to nor reset the invalid count.
with reserved as (select public.reserve_ai_generation('monthly') as value)
select public.settle_ai_generation((value->>'leaseId')::uuid, 'success') from reserved;
with reserved as (select public.reserve_ai_generation('monthly') as value)
select public.settle_ai_generation((value->>'leaseId')::uuid, 'failure') from reserved;
select is(
  (select pending from public.ai_invalid_screenshot_counters where user_id = auth.uid()),
  3::smallint,
  'successes and failures leave the invalid count unchanged'
);

-- The count restarts after 30 days.
update public.ai_invalid_screenshot_counters
set window_started_at = now() - interval '31 days'
where user_id = auth.uid();
with reserved as (select public.reserve_ai_generation('monthly') as value)
select public.settle_ai_generation((value->>'leaseId')::uuid, 'invalid_screenshot') from reserved;
select is(
  (select pending from public.ai_invalid_screenshot_counters where user_id = auth.uid()),
  1::smallint,
  'an expired window restarts the count at one instead of continuing it'
);
select ok(
  (select window_started_at from public.ai_invalid_screenshot_counters where user_id = auth.uid())
    > now() - interval '1 minute',
  'the new window starts at the first invalid screenshot after expiry'
);

update public.ai_invalid_screenshot_counters
set pending = 4, window_started_at = now() - interval '29 days'
where user_id = auth.uid();
with reserved as (select public.reserve_ai_generation('monthly') as value)
select public.settle_ai_generation((value->>'leaseId')::uuid, 'invalid_screenshot') from reserved;
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  4::bigint,
  'a fifth invalid screenshot inside the 30-day window is charged'
);

-- ---------------------------------------------------------------------------
-- Plan limits are unchanged and can never be exceeded
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000603', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 499);
with reserved as (select public.reserve_ai_generation('monthly') as value)
insert into settle_state (name, lease_id)
select 'monthly-499', (value->>'leaseId')::uuid from reserved;
select ok(
  exists (select 1 from settle_state where name = 'monthly-499'),
  'the Monthly plan allows attempt 500'
);
select public.settle_ai_generation((select lease_id from settle_state where name = 'monthly-499'), 'success');
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  500::bigint,
  'the 500th attempt is recorded'
);
select is(
  public.reserve_ai_generation('monthly')->>'status',
  'usage_limit',
  'the Monthly plan rejects attempt 501'
);
select ok(
  (public.reserve_ai_generation('monthly')->>'retryAt') is not null,
  'a rejected reservation reports when the limit lifts'
);
select is(
  (select count(*) from public.ai_generation_leases where user_id = auth.uid()),
  0::bigint,
  'a rejected reservation holds no lease'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000604', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 124);
with reserved as (select public.reserve_ai_generation('weekly') as value)
insert into settle_state (name, lease_id)
select 'weekly-124', (value->>'leaseId')::uuid from reserved;
select ok(
  exists (select 1 from settle_state where name = 'weekly-124'),
  'the Weekly plan allows attempt 125'
);
select public.settle_ai_generation((select lease_id from settle_state where name = 'weekly-124'), 'success');
select is(
  public.reserve_ai_generation('weekly')->>'status',
  'usage_limit',
  'the Weekly plan rejects attempt 126'
);

-- A fifth invalid screenshot at the boundary cannot push past the limit.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000605', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 499);
insert into public.ai_invalid_screenshot_counters (user_id, pending, window_started_at)
values (auth.uid(), 4, now());
with reserved as (select public.reserve_ai_generation('monthly') as value)
select public.settle_ai_generation((value->>'leaseId')::uuid, 'invalid_screenshot') from reserved;
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  500::bigint,
  'the charge for a fifth invalid screenshot stops exactly at the limit'
);

-- ---------------------------------------------------------------------------
-- Leases, users and older callers
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000606', true);
with reserved as (select public.reserve_ai_generation('monthly') as value)
insert into settle_state (name, lease_id)
select 'other-user', (value->>'leaseId')::uuid from reserved;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000607', true);
select is(
  public.settle_ai_generation((select lease_id from settle_state where name = 'other-user'), 'success')->>'status',
  'not_found',
  'a user cannot settle another user''s lease'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  0::bigint,
  'settling a foreign lease charges nobody'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000606', true);
update public.ai_generation_leases
set expires_at = now() - interval '1 second'
where user_id = auth.uid();
select is(
  public.settle_ai_generation((select lease_id from settle_state where name = 'other-user'), 'success')->>'charged',
  'true',
  'an expired lease that was not replaced still settles'
);

with reserved as (select public.reserve_ai_generation('monthly') as value)
insert into settle_state (name, lease_id)
select 'stale', (value->>'leaseId')::uuid from reserved;
update public.ai_generation_leases set expires_at = now() - interval '1 second' where user_id = auth.uid();
select public.reserve_ai_generation('monthly');
select is(
  public.settle_ai_generation((select lease_id from settle_state where name = 'stale'), 'success')->>'status',
  'not_found',
  'a lease replaced by a newer reservation cannot be settled or charged'
);

-- Older callers keep their behavior: charge at claim, shared lease and lock.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000608', true);
select is(
  public.begin_ai_generation(false, 'monthly')->>'status',
  'allowed',
  'the older begin function still works'
);
select is(
  (select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  1::bigint,
  'the older begin function still charges at claim time'
);
select is(
  public.reserve_ai_generation('monthly')->>'status',
  'generation_in_progress',
  'a lease taken by the older function blocks the new reservation'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000609', true);
select public.reserve_ai_generation('monthly');
select is(
  public.begin_ai_generation(false, 'monthly')->>'status',
  'generation_in_progress',
  'a lease taken by the new function blocks the older begin'
);

select * from finish();
rollback;
