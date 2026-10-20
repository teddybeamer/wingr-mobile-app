begin;

select plan(23);
set local session_replication_role = replica;

-- The functions are service-role only and take the user explicitly. The v2 endpoint
-- binds a trial to sha256(trial id) rather than to the per-request DeviceCheck
-- token, so every call for one trial below uses one hash.
create temporary table ctx as
select
  '00000000-0000-4000-8000-000000000801'::uuid as user_a,
  '00000000-0000-4000-8000-000000000802'::uuid as user_b,
  '00000000-0000-4000-8000-0000000008a1'::uuid as trial_1,
  '00000000-0000-4000-8000-0000000008a2'::uuid as trial_2,
  '00000000-0000-4000-8000-0000000008a3'::uuid as trial_3,
  repeat('a', 64) as hash_1,
  repeat('b', 64) as hash_2,
  repeat('c', 64) as hash_3;

select is(
  (select public.begin_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'started',
  'a first request takes the trial'
);
select is(
  (select public.begin_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'generation_in_progress',
  'a concurrent request for the same trial is refused while generating'
);
select ok(
  (select public.begin_onboarding_device_trial(user_a, trial_1, hash_1)->>'retryAt' from ctx) is not null,
  'the refusal says when to retry'
);
select is(
  (select public.begin_onboarding_device_trial(user_b, trial_2, hash_1)->>'status' from ctx),
  'generation_in_progress',
  'another account using the same binding cannot start while it is generating'
);
select throws_ok(
  $$select public.begin_onboarding_device_trial(user_a, trial_1, hash_2) from ctx$$,
  '42501',
  'Trial does not belong to this device.',
  'a different binding for an existing trial is rejected, which is why v2 binds to the trial ID'
);
select throws_ok(
  $$select public.begin_onboarding_device_trial(user_b, trial_1, hash_3) from ctx$$,
  '23505',
  null,
  'another account cannot take over an existing trial ID'
);

-- A failure abandons the trial and costs nothing.
select is(
  (select public.abandon_onboarding_device_trial(user_a, trial_1, hash_1) from ctx),
  true,
  'abandoning a generating trial removes it'
);
select is(
  (select count(*)::int from public.onboarding_device_trials),
  0,
  'no trial row is left behind'
);
select is(
  (select count(*)::int from public.onboarding_ai_reply_claims where user_id = (select user_a from ctx)),
  0,
  'a failed generation makes no account claim'
);
select is(
  (select count(*)::int from public.ai_generation_attempts where user_id = (select user_a from ctx)),
  0,
  'a failed generation records no attempt'
);
select is(
  (select public.begin_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'started',
  'the same trial can start again straight away after a failure'
);

-- A stored but unfinalized result is also free and is not abandoned by a late failure.
select is(
  (select public.store_onboarding_device_trial_result(user_a, trial_1, hash_1, 'cipher', 'iv')->>'status' from ctx),
  'result_ready',
  'a valid reply is stored for delivery'
);
select is(
  (select public.abandon_onboarding_device_trial(user_a, trial_1, hash_1) from ctx),
  false,
  'a stored result cannot be abandoned'
);
select is(
  (select count(*)::int from public.onboarding_ai_reply_claims),
  0,
  'a stored result alone does not consume the free reply'
);
select is(
  (select public.begin_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'result_ready',
  'a retry receives the stored result without a new generation'
);

-- Finalizing is what consumes the free reply, exactly once.
select is(
  (select public.finalize_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'finalized',
  'finalizing releases the reply'
);
select is(
  (select count(*)::int from public.onboarding_ai_reply_claims where user_id = (select user_a from ctx)),
  1,
  'finalizing makes one account claim'
);
select is(
  (select count(*)::int from public.ai_generation_attempts where user_id = (select user_a from ctx)),
  1,
  'finalizing records one attempt'
);
select is(
  (select public.finalize_onboarding_device_trial(user_a, trial_1, hash_1)->>'status' from ctx),
  'replay',
  'finalizing again replays instead of consuming again'
);
select is(
  (select count(*)::int from public.onboarding_ai_reply_claims where user_id = (select user_a from ctx)),
  1,
  'replays never add a second claim'
);
select is(
  (select public.begin_onboarding_device_trial(user_a, trial_2, hash_2)->>'status' from ctx),
  'onboarding_reply_used',
  'a used account cannot start another free reply'
);

-- A lease that ran out cannot store a late result.
select is(
  (select public.begin_onboarding_device_trial(user_b, trial_3, hash_3)->>'status' from ctx),
  'started',
  'another account can start its own trial'
);
update public.onboarding_device_trials
set lease_expires_at = clock_timestamp() - interval '1 second'
where trial_id = (select trial_3 from ctx);
select is(
  (select public.store_onboarding_device_trial_result(user_b, trial_3, hash_3, 'cipher', 'iv')->>'status' from ctx),
  'trial_unavailable',
  'an expired lease cannot store a late result'
);

select * from finish();
rollback;
