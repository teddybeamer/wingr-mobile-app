begin;
select no_plan();
set local session_replication_role = replica;

-- Weekly: an event outside the seven-day window is excluded, attempt 125 is
-- allowed, and attempt 126 is rejected without another insert.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000601', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 124);
insert into public.ai_generation_attempts (user_id, attempted_at)
values (auth.uid(), now() - interval '8 days');

select is(
  public.claim_ai_generation_attempt_with_availability(false, 'weekly'),
  '{"status":"allowed","retryAt":null}'::jsonb,
  'Weekly attempt 125 succeeds and an attempt older than seven days does not count'
);
select is(
  public.claim_ai_generation_attempt_with_availability(false, 'weekly'),
  jsonb_build_object('status', 'usage_limit', 'retryAt', now() + interval '6 days'),
  'Weekly attempt 126 is blocked with seven-day availability'
);
select is(
  (
    select count(*)
    from public.ai_generation_attempts
    where user_id = auth.uid()
      and attempted_at > now() - interval '7 days'
  ),
  125::bigint,
  'a rejected Weekly claim adds no attempt'
);

-- Monthly retains the existing 500-attempt, 30-day behavior.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000602', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 499);
insert into public.ai_generation_attempts (user_id, attempted_at)
values (auth.uid(), now() - interval '31 days');

select is(
  public.claim_ai_generation_attempt_with_availability(false, 'monthly'),
  '{"status":"allowed","retryAt":null}'::jsonb,
  'Monthly attempt 500 succeeds and an attempt older than 30 days does not count'
);
select is(
  public.claim_ai_generation_attempt_with_availability(false, 'monthly'),
  jsonb_build_object('status', 'usage_limit', 'retryAt', now() + interval '29 days'),
  'Monthly attempt 501 is blocked with 30-day availability'
);
select is(
  (
    select count(*)
    from public.ai_generation_attempts
    where user_id = auth.uid()
      and attempted_at > now() - interval '30 days'
  ),
  500::bigint,
  'a rejected Monthly claim adds no attempt'
);

-- Existing history is interpreted using the currently selected server policy.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000603', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 125);

select is(
  public.claim_ai_generation_attempt_with_availability(false, 'weekly')->>'status',
  'usage_limit',
  'current Weekly policy rejects 125 existing attempts'
);
select is(
  public.claim_ai_generation_attempt_with_availability(false, 'monthly')->>'status',
  'allowed',
  'current Monthly policy applies to the same intact attempt history'
);

select throws_ok(
  $$select public.claim_ai_generation_attempt_with_availability(false, 'client-invented')$$,
  '22023',
  'Unsupported subscription plan.',
  'unknown database policies fail closed'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.claim_ai_generation_attempt_with_availability(boolean, text)',
    'execute'
  ),
  'anonymous callers cannot execute plan-specific claims'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_ai_generation_attempt_with_availability(boolean, text)',
    'execute'
  ),
  'authenticated edge-function callers can execute fixed plan claims'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_ai_generation_attempt_with_policy(integer, interval)',
    'execute'
  ),
  'authenticated callers cannot choose arbitrary limits or windows'
);

select * from finish();
rollback;
