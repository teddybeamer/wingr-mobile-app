begin;

select plan(10);
set local session_replication_role = replica;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000701',
  true
);
select is(
  public.has_claimed_onboarding_ai_reply(),
  false,
  'an authenticated user without a claim reports false'
);

insert into public.onboarding_ai_reply_claims (user_id)
values ('00000000-0000-4000-8000-000000000701');

select is(
  public.has_claimed_onboarding_ai_reply(),
  true,
  'an authenticated user can read their own claim status'
);

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000702',
  true
);
select is(
  public.has_claimed_onboarding_ai_reply(),
  false,
  'one user cannot observe another user claim'
);

insert into public.onboarding_ai_reply_claims (user_id)
values ('00000000-0000-4000-8000-000000000702');

select is(
  public.has_claimed_onboarding_ai_reply(),
  true,
  'the second user can read only their own claim status'
);

select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select public.has_claimed_onboarding_ai_reply()$$,
  '42501',
  'An authenticated user is required.',
  'the function rejects requests without an authenticated identity'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.has_claimed_onboarding_ai_reply()',
    'execute'
  ),
  'anonymous callers cannot execute the claim-status function'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.has_claimed_onboarding_ai_reply()',
    'execute'
  ),
  'authenticated callers can execute the claim-status function'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.onboarding_ai_reply_claims',
    'select'
  ),
  'authenticated callers still cannot read the claims table directly'
);
select is(
  (
    select count(*)
    from public.onboarding_ai_reply_claims
    where user_id in (
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000702'
    )
  ),
  2::bigint,
  'status reads do not create or delete onboarding claims'
);
select is(
  (
    select count(*)
    from public.ai_generation_attempts
    where user_id in (
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000702'
    )
  ),
  0::bigint,
  'status reads do not create AI generation attempts'
);

select * from finish();
rollback;
