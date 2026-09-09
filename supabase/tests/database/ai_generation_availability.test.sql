begin;
select no_plan();
set local session_replication_role = replica;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '1 day' from generate_series(1, 499);
insert into public.ai_generation_attempts (user_id, attempted_at)
values (auth.uid(), now() - interval '30 days');

select is(public.claim_ai_generation_attempt_with_availability(),
  '{"status":"allowed","retryAt":null}'::jsonb,
  'attempt 500 succeeds, excluding an attempt exactly 30 days old');
select is(public.claim_ai_generation_attempt_with_availability(),
  jsonb_build_object('status', 'usage_limit', 'retryAt', now() + interval '29 days'),
  'attempt 501 is blocked with the first available time');
select is((select count(*) from public.ai_generation_attempts where user_id = auth.uid() and attempted_at > now() - interval '30 days'),
  500::bigint, 'a rejected claim adds no attempt');

insert into public.ai_generation_attempts (user_id, attempted_at)
values (auth.uid(), now() - interval '20 days');
select is(public.claim_ai_generation_attempt_with_availability(),
  jsonb_build_object('status', 'usage_limit', 'retryAt', now() + interval '29 days'),
  'over-cap availability uses the 500th newest attempt, not the oldest');
delete from public.ai_generation_attempts where user_id = auth.uid() and attempted_at = now() - interval '20 days';
update public.ai_generation_attempts set attempted_at = now() - interval '30 days'
where id = (select min(id) from public.ai_generation_attempts where user_id = auth.uid() and attempted_at = now() - interval '1 day');
select is(public.claim_ai_generation_attempt_with_availability()->>'status', 'allowed',
  'generation resumes when an active attempt expires');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
select is(public.claim_ai_generation_attempt_with_availability()->>'status', 'allowed',
  'another user has an independent allowance');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000303', true);
insert into public.ai_generation_attempts (user_id, attempted_at)
select auth.uid(), now() - interval '2 days' from generate_series(1, 500);
select is(public.claim_ai_generation_attempt_with_availability(true),
  jsonb_build_object('status', 'usage_limit', 'retryAt', now() + interval '28 days'),
  'onboarding returns availability when the rolling allowance is exhausted');
select is((select count(*) from public.onboarding_ai_reply_claims where user_id = auth.uid()),
  0::bigint, 'a blocked onboarding request does not consume its one-time claim');
delete from public.ai_generation_attempts
where id = (select min(id) from public.ai_generation_attempts where user_id = auth.uid());
select is(public.claim_ai_generation_attempt_with_availability(true),
  '{"status":"allowed","retryAt":null}'::jsonb, 'onboarding can take the 500th slot');
select is(public.claim_ai_generation_attempt_with_availability(true),
  '{"status":"onboarding_reply_used","retryAt":null}'::jsonb, 'onboarding retains its one-time restriction');
select is((select count(*) from public.ai_generation_attempts where user_id = auth.uid()),
  500::bigint, 'onboarding rejection adds no attempt');

select ok(not has_function_privilege('anon', 'public.claim_ai_generation_attempt_with_availability(boolean)', 'execute'),
  'anonymous role cannot execute the wrapper');
select ok(has_function_privilege('authenticated', 'public.claim_ai_generation_attempt_with_availability(boolean)', 'execute'),
  'authenticated users can execute the wrapper');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok('select public.claim_ai_generation_attempt_with_availability()', '42501',
  'An authenticated user is required.', 'wrapper requires a user identity');

select * from finish();
rollback;
