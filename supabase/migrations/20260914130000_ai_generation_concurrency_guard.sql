create table public.ai_generation_leases (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lease_id uuid not null,
  expires_at timestamptz not null
);

alter table public.ai_generation_leases enable row level security;

create function public.begin_ai_generation(is_onboarding boolean default false)
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

  -- Serialize lease inspection with the existing usage and onboarding claims.
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

  -- Reuse the existing locked claim so the rolling-window calculation,
  -- availability timestamp, and onboarding semantics remain unchanged.
  claim_result := public.claim_ai_generation_attempt_with_availability(is_onboarding);
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

create function public.release_ai_generation_lease(requested_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
  deleted_rows integer;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  delete from public.ai_generation_leases
  where user_id = requesting_user_id
    and lease_id = requested_lease_id;

  get diagnostics deleted_rows = row_count;
  return deleted_rows = 1;
end;
$$;

revoke all on table public.ai_generation_leases from public, anon, authenticated;
revoke all on function public.begin_ai_generation(boolean) from public, anon;
revoke all on function public.release_ai_generation_lease(uuid) from public, anon;
grant execute on function public.begin_ai_generation(boolean) to authenticated;
grant execute on function public.release_ai_generation_lease(uuid) to authenticated;
