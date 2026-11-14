-- Unlimited generations for Pro users, behind a fair use guard.
--
-- Replaces only the body of reserve_ai_generation (used by ai-conversation-v2
-- and ai-opener): instead of 125 attempts per 7 days (Weekly) and 500 per 30
-- days (Monthly), every Pro plan may make at most 200 settled attempts in any
-- rolling 24 hours. Nothing else changes: the signature and grants, the
-- one-generation-at-a-time lease, settle_ai_generation and its charge rules
-- (success = 1, failure = 0, every 5th invalid screenshot = 1), and the older
-- begin_ai_generation path kept for the frozen v1 endpoint.

create or replace function public.reserve_ai_generation(subscription_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
  requested_limit integer;
  requested_window interval;
  active_lease_expires_at timestamptz;
  attempts_in_window bigint;
  retry_at timestamptz;
  generated_lease_id uuid;
  generated_lease_expires_at timestamptz;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  -- Unlimited for every Pro plan, with one fair use guard against abuse: at
  -- most 200 settled attempts in any rolling 24 hours. The plan is still
  -- validated so a caller cannot invent one.
  if subscription_plan is null or subscription_plan not in ('weekly', 'monthly') then
    raise exception 'Unsupported subscription plan.' using errcode = '22023';
  end if;
  requested_limit := 200;
  requested_window := interval '24 hours';

  -- The lock key is shared with begin_ai_generation and release_ai_generation_lease.
  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  select expires_at into active_lease_expires_at
  from public.ai_generation_leases
  where user_id = requesting_user_id;

  if active_lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'status', 'generation_in_progress',
      'retryAt', active_lease_expires_at
    );
  end if;

  select count(*) into attempts_in_window
  from public.ai_generation_attempts
  where user_id = requesting_user_id
    and attempted_at > now() - requested_window;

  -- At most one lease is active, and a settlement adds at most one attempt, so a
  -- user below the limit here can never finish above it.
  if attempts_in_window >= requested_limit then
    select attempted_at + requested_window into retry_at
    from public.ai_generation_attempts
    where user_id = requesting_user_id
      and attempted_at > now() - requested_window
    order by attempted_at desc
    offset requested_limit - 1 limit 1;

    return jsonb_build_object('status', 'usage_limit', 'retryAt', retry_at);
  end if;

  generated_lease_id := gen_random_uuid();
  generated_lease_expires_at := clock_timestamp() + interval '60 seconds';

  insert into public.ai_generation_leases (user_id, lease_id, expires_at)
  values (
    requesting_user_id,
    generated_lease_id,
    generated_lease_expires_at
  )
  on conflict (user_id) do update
  set lease_id = excluded.lease_id,
      expires_at = excluded.expires_at;

  return jsonb_build_object(
    'status', 'allowed',
    'retryAt', null,
    'leaseId', generated_lease_id,
    'expiresAt', generated_lease_expires_at
  );
end;
$$;
