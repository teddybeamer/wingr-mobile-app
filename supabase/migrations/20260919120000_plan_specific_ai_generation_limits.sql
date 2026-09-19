-- Keep plan thresholds in the database transaction that records attempts.
-- This helper is private; authenticated callers use the fixed-plan wrappers below.
create function public.claim_ai_generation_attempt_with_policy(
  requested_limit integer,
  requested_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  if not (
    (requested_limit = 125 and requested_window = interval '7 days')
    or (requested_limit = 500 and requested_window = interval '30 days')
  ) then
    raise exception 'Unsupported AI generation policy.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  if (
    select count(*)
    from public.ai_generation_attempts
    where user_id = requesting_user_id
      and attempted_at > now() - requested_window
  ) >= requested_limit then
    return false;
  end if;

  insert into public.ai_generation_attempts (user_id)
  values (requesting_user_id);

  return true;
end;
$$;

revoke all on function public.claim_ai_generation_attempt_with_policy(integer, interval)
  from public, anon, authenticated;

-- Preserve the original Monthly claim contract for older deployed functions.
create or replace function public.claim_ai_generation_attempt()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.claim_ai_generation_attempt_with_policy(500, interval '30 days');
end;
$$;

revoke all on function public.claim_ai_generation_attempt() from public;
grant execute on function public.claim_ai_generation_attempt() to authenticated;

-- Onboarding remains one-time and continues to use the legacy 500/30-day policy.
create or replace function public.claim_onboarding_ai_generation_attempt()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  if exists (
    select 1
    from public.onboarding_ai_reply_claims
    where user_id = requesting_user_id
  ) then
    return 'onboarding_reply_used';
  end if;

  if not public.claim_ai_generation_attempt_with_policy(
    500,
    interval '30 days'
  ) then
    return 'usage_limit';
  end if;

  insert into public.onboarding_ai_reply_claims (user_id)
  values (requesting_user_id);

  return 'allowed';
end;
$$;

revoke all on function public.claim_onboarding_ai_generation_attempt() from public;
grant execute on function public.claim_onboarding_ai_generation_attempt() to authenticated;

create function public.claim_ai_generation_attempt_with_availability(
  is_onboarding boolean,
  subscription_plan text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim_status text;
  requested_limit integer;
  requested_window interval;
  retry_at timestamptz;
begin
  if is_onboarding then
    requested_limit := 500;
    requested_window := interval '30 days';
    claim_status := public.claim_onboarding_ai_generation_attempt();
  else
    case subscription_plan
      when 'weekly' then
        requested_limit := 125;
        requested_window := interval '7 days';
      when 'monthly' then
        requested_limit := 500;
        requested_window := interval '30 days';
      else
        raise exception 'Unsupported subscription plan.' using errcode = '22023';
    end case;

    if public.claim_ai_generation_attempt_with_policy(
      requested_limit,
      requested_window
    ) then
      claim_status := 'allowed';
    else
      claim_status := 'usage_limit';
    end if;
  end if;

  if claim_status = 'usage_limit' then
    select attempted_at + requested_window into retry_at
    from public.ai_generation_attempts
    where user_id = auth.uid()
      and attempted_at > now() - requested_window
    order by attempted_at desc
    offset requested_limit - 1 limit 1;
  end if;

  return jsonb_build_object('status', claim_status, 'retryAt', retry_at);
end;
$$;

revoke all on function public.claim_ai_generation_attempt_with_availability(boolean, text)
  from public, anon;
grant execute on function public.claim_ai_generation_attempt_with_availability(boolean, text)
  to authenticated;

-- Preserve the original one-argument Monthly/onboarding RPC contract.
create or replace function public.claim_ai_generation_attempt_with_availability(
  is_onboarding boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.claim_ai_generation_attempt_with_availability(
    is_onboarding,
    'monthly'
  );
end;
$$;

revoke all on function public.claim_ai_generation_attempt_with_availability(boolean)
  from public, anon;
grant execute on function public.claim_ai_generation_attempt_with_availability(boolean)
  to authenticated;

create function public.begin_ai_generation(
  is_onboarding boolean,
  subscription_plan text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
  active_lease_expires_at timestamptz;
  claim_result jsonb;
  generated_lease_id uuid;
  generated_lease_expires_at timestamptz;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

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

  claim_result := public.claim_ai_generation_attempt_with_availability(
    is_onboarding,
    subscription_plan
  );
  if claim_result->>'status' is distinct from 'allowed' then
    return claim_result;
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

  return claim_result || jsonb_build_object(
    'leaseId', generated_lease_id,
    'expiresAt', generated_lease_expires_at
  );
end;
$$;

revoke all on function public.begin_ai_generation(boolean, text) from public, anon;
grant execute on function public.begin_ai_generation(boolean, text) to authenticated;

-- Preserve the original one-argument Monthly/onboarding RPC contract.
create or replace function public.begin_ai_generation(
  is_onboarding boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.begin_ai_generation(is_onboarding, 'monthly');
end;
$$;

revoke all on function public.begin_ai_generation(boolean) from public, anon;
grant execute on function public.begin_ai_generation(boolean) to authenticated;
