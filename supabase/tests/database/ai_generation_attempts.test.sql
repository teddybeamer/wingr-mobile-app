begin;

select plan(6);

select has_table('public', 'ai_generation_attempts', 'attempt events are persisted');
select has_index(
  'public',
  'ai_generation_attempts',
  'ai_generation_attempts_user_id_attempted_at_idx',
  'rolling count has a user and timestamp index'
);
select is(
  (
    select confdeltype
    from pg_constraint
    where conrelid = 'public.ai_generation_attempts'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.ai_generation_attempts'::regclass and attname = 'user_id')]
  ),
  'c',
  'Auth-user deletion cascades generation-attempt metadata'
);

set local session_replication_role = replica;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
with reference_time as (select now() as value)
insert into public.ai_generation_attempts (user_id, attempted_at)
select '00000000-0000-0000-0000-000000000101'::uuid, value - interval '30 days'
from reference_time
union all
select '00000000-0000-0000-0000-000000000101'::uuid, value - interval '1 day'
from reference_time, generate_series(1, 499);

select is(
  public.claim_ai_generation_attempt(),
  true,
  'an attempt exactly 30 days old does not count toward the limit'
);

select is(
  (
    select count(*)
    from public.ai_generation_attempts
    where user_id = '00000000-0000-0000-0000-000000000101'::uuid
      and attempted_at > now() - interval '30 days'
  ),
  500::bigint,
  'the claim becomes the 500th attempt after excluding the exact boundary'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
with reference_time as (select now() as value)
insert into public.ai_generation_attempts (user_id, attempted_at)
select '00000000-0000-0000-0000-000000000102'::uuid,
       value - interval '30 days' + interval '1 microsecond'
from reference_time
union all
select '00000000-0000-0000-0000-000000000102'::uuid, value - interval '1 day'
from reference_time, generate_series(1, 499);

select is(
  public.claim_ai_generation_attempt(),
  false,
  'an attempt one microsecond newer than 30 days counts toward the limit'
);

select * from finish();
rollback;
