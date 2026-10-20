-- Charge a generation when it is settled, not when it is claimed.
--
-- Additive only: no existing table definition, function or grant is changed, so
-- older deployed functions (which call begin_ai_generation and charge at claim
-- time) keep their exact behavior. The v2 endpoint uses the two functions below.
--
--   reserve_ai_generation(plan)  checks the plan limit against settled attempts and
--                                takes the per-user lease. It inserts no attempt.
--   settle_ai_generation(lease, outcome)
--                                ends the lease and applies the charge rule:
--                                  success             -> 1 attempt
--                                  failure             -> 0 attempts
--                                  invalid_screenshot  -> every 5th in a 30-day
--                                                         window costs 1 attempt
--
-- Both take the same per-user advisory lock and use the same lease table as the
-- older functions, so there is still at most one generation in flight per user,
-- across every endpoint version.

-- A lease can be charged at most once, even if settlement is repeated.
alter table public.ai_generation_attempts
  add column lease_id uuid;

create unique index ai_generation_attempts_lease_id_idx
  on public.ai_generation_attempts (lease_id)
  where lease_id is not null;

-- Invalid screenshots (unreadable_image, no_conversation) counted toward the next
-- charge. The count persists across sessions and restarts after 30 days.
create table public.ai_invalid_screenshot_counters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pending smallint not null check (pending between 0 and 4),
  window_started_at timestamptz not null
);

alter table public.ai_invalid_screenshot_counters enable row level security;
revoke all on table public.ai_invalid_screenshot_counters
  from public, anon, authenticated;

create function public.reserve_ai_generation(subscription_plan text)
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

  -- Same limits and windows as claim_ai_generation_attempt_with_availability.
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

create function public.settle_ai_generation(
  requested_lease_id uuid,
  outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
  deleted_rows integer;
  current_pending smallint;
  current_window_started_at timestamptz;
  next_pending integer;
  next_window_started_at timestamptz;
  charged boolean := false;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  if outcome not in ('success', 'invalid_screenshot', 'failure') then
    raise exception 'Unsupported settlement outcome.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  -- Ending the lease is what makes settlement idempotent: only the call that
  -- removes the lease can charge, so a repeated or concurrent settlement of the
  -- same lease is a no-op. An expired lease that was not replaced still settles.
  delete from public.ai_generation_leases
  where user_id = requesting_user_id
    and lease_id = requested_lease_id;

  get diagnostics deleted_rows = row_count;
  if deleted_rows <> 1 then
    return jsonb_build_object('status', 'not_found', 'charged', false);
  end if;

  if outcome = 'success' then
    insert into public.ai_generation_attempts (user_id, lease_id)
    values (requesting_user_id, requested_lease_id)
    on conflict (lease_id) where lease_id is not null do nothing;
    charged := true;
  elsif outcome = 'invalid_screenshot' then
    select pending, window_started_at
    into current_pending, current_window_started_at
    from public.ai_invalid_screenshot_counters
    where user_id = requesting_user_id;

    -- A new 30-day window starts at the first invalid screenshot after the count
    -- was empty (never counted, just charged, or expired).
    if not found
       or current_pending = 0
       or current_window_started_at <= now() - interval '30 days' then
      next_pending := 1;
      next_window_started_at := now();
    else
      next_pending := current_pending + 1;
      next_window_started_at := current_window_started_at;
    end if;

    if next_pending >= 5 then
      insert into public.ai_generation_attempts (user_id, lease_id)
      values (requesting_user_id, requested_lease_id)
      on conflict (lease_id) where lease_id is not null do nothing;
      charged := true;
      next_pending := 0;
    end if;

    insert into public.ai_invalid_screenshot_counters (
      user_id,
      pending,
      window_started_at
    )
    values (requesting_user_id, next_pending, next_window_started_at)
    on conflict (user_id) do update
    set pending = excluded.pending,
        window_started_at = excluded.window_started_at;
  end if;

  return jsonb_build_object('status', 'settled', 'charged', charged);
end;
$$;

revoke all on function public.reserve_ai_generation(text) from public, anon;
revoke all on function public.settle_ai_generation(uuid, text) from public, anon;
grant execute on function public.reserve_ai_generation(text) to authenticated;
grant execute on function public.settle_ai_generation(uuid, text) to authenticated;
