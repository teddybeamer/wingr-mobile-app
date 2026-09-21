-- DeviceCheck remains the durable device-level allowance. This table holds
-- only short-lived, encrypted delivery state so a successful result can be
-- replayed without issuing Gemini a second time.
create table public.onboarding_device_trials (
  trial_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_token_hash text not null check (device_token_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('generating', 'result_ready', 'finalized')),
  lease_expires_at timestamptz,
  result_ciphertext text,
  result_iv text,
  result_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (state = 'generating' and lease_expires_at is not null and result_ciphertext is null and result_iv is null and result_expires_at is null)
    or (state in ('result_ready', 'finalized') and lease_expires_at is null and result_ciphertext is not null and result_iv is not null and result_expires_at is not null)
  )
);

create unique index onboarding_device_trials_active_token_idx
  on public.onboarding_device_trials (device_token_hash)
  where state in ('generating', 'result_ready');

create index onboarding_device_trials_expiry_idx
  on public.onboarding_device_trials (result_expires_at)
  where result_expires_at is not null;

alter table public.onboarding_device_trials enable row level security;
revoke all on table public.onboarding_device_trials from anon, authenticated;

create function public.cleanup_expired_onboarding_device_trials()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.onboarding_device_trials
  where (state = 'generating' and lease_expires_at <= clock_timestamp())
     or (state in ('result_ready', 'finalized') and result_expires_at <= clock_timestamp());
end;
$$;

revoke all on function public.cleanup_expired_onboarding_device_trials() from public, anon, authenticated;

-- The access checks below also remove stale rows opportunistically, but this
-- scheduled job enforces the 15-minute retention ceiling when no requests are
-- arriving. pg_cron is a supported Supabase Postgres extension.
create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'cleanup-expired-onboarding-device-trials',
  '* * * * *',
  $$select public.cleanup_expired_onboarding_device_trials()$$
);

create function public.begin_onboarding_device_trial(
  requested_user_id uuid,
  onboarding_trial_id uuid,
  requested_device_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := requested_user_id;
  existing_trial public.onboarding_device_trials%rowtype;
  generated_lease_expires_at timestamptz := clock_timestamp() + interval '60 seconds';
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if requested_device_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid device token hash.' using errcode = '22023';
  end if;

  perform public.cleanup_expired_onboarding_device_trials();
  perform pg_advisory_xact_lock(hashtextextended(requested_device_token_hash, 0));

  select * into existing_trial
  from public.onboarding_device_trials
  where trial_id = onboarding_trial_id
    and user_id = requesting_user_id;

  if found then
    if existing_trial.device_token_hash <> requested_device_token_hash then
      raise exception 'Trial does not belong to this device.' using errcode = '42501';
    end if;
    if existing_trial.state = 'finalized' then
      return jsonb_build_object(
        'status', 'replay',
        'ciphertext', existing_trial.result_ciphertext,
        'iv', existing_trial.result_iv
      );
    end if;
    if existing_trial.state = 'result_ready' then
      return jsonb_build_object(
        'status', 'result_ready',
        'ciphertext', existing_trial.result_ciphertext,
        'iv', existing_trial.result_iv
      );
    end if;
    return jsonb_build_object(
      'status', 'generation_in_progress',
      'retryAt', existing_trial.lease_expires_at
    );
  end if;

  if exists (
    select 1 from public.onboarding_ai_reply_claims
    where user_id = requesting_user_id
  ) then
    return jsonb_build_object('status', 'onboarding_reply_used');
  end if;

  if exists (
    select 1 from public.ai_generation_attempts
    where user_id = requesting_user_id
      and attempted_at > now() - interval '30 days'
    offset 499 limit 1
  ) then
    return jsonb_build_object('status', 'usage_limit');
  end if;

  if exists (
    select 1 from public.onboarding_device_trials
    where device_token_hash = requested_device_token_hash
      and state in ('generating', 'result_ready')
  ) then
    return jsonb_build_object(
      'status', 'generation_in_progress',
      'retryAt', generated_lease_expires_at
    );
  end if;

  insert into public.onboarding_device_trials (
    trial_id, user_id, device_token_hash, state, lease_expires_at
  ) values (
    onboarding_trial_id,
    requesting_user_id,
    requested_device_token_hash,
    'generating',
    generated_lease_expires_at
  );

  return jsonb_build_object(
    'status', 'started',
    'retryAt', generated_lease_expires_at
  );
end;
$$;

create function public.store_onboarding_device_trial_result(
  requested_user_id uuid,
  onboarding_trial_id uuid,
  requested_device_token_hash text,
  encrypted_result text,
  encrypted_result_iv text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := requested_user_id;
  generated_result_expires_at timestamptz := clock_timestamp() + interval '15 minutes';
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if requested_device_token_hash !~ '^[0-9a-f]{64}$'
    or length(encrypted_result) > 100000
    or length(encrypted_result_iv) > 128 then
    raise exception 'Invalid onboarding trial result.' using errcode = '22023';
  end if;

  update public.onboarding_device_trials
  set state = 'result_ready',
      lease_expires_at = null,
      result_ciphertext = encrypted_result,
      result_iv = encrypted_result_iv,
      result_expires_at = generated_result_expires_at,
      updated_at = clock_timestamp()
  where trial_id = onboarding_trial_id
    and user_id = requesting_user_id
    and device_token_hash = requested_device_token_hash
    and state = 'generating'
    and lease_expires_at > clock_timestamp();

  if not found then
    return jsonb_build_object('status', 'trial_unavailable');
  end if;
  return jsonb_build_object('status', 'result_ready');
end;
$$;

create function public.finalize_onboarding_device_trial(
  requested_user_id uuid,
  onboarding_trial_id uuid,
  requested_device_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := requested_user_id;
  existing_trial public.onboarding_device_trials%rowtype;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  select * into existing_trial
  from public.onboarding_device_trials
  where trial_id = onboarding_trial_id
    and user_id = requesting_user_id
    and device_token_hash = requested_device_token_hash
  for update;

  if not found or existing_trial.result_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'trial_unavailable');
  end if;
  if existing_trial.state = 'finalized' then
    return jsonb_build_object(
      'status', 'replay',
      'ciphertext', existing_trial.result_ciphertext,
      'iv', existing_trial.result_iv
    );
  end if;
  if existing_trial.state <> 'result_ready' then
    return jsonb_build_object('status', 'trial_unavailable');
  end if;
  if exists (
    select 1 from public.onboarding_ai_reply_claims
    where user_id = requesting_user_id
  ) then
    return jsonb_build_object('status', 'onboarding_reply_used');
  end if;

  insert into public.onboarding_ai_reply_claims (user_id)
  values (requesting_user_id);
  insert into public.ai_generation_attempts (user_id)
  values (requesting_user_id);

  update public.onboarding_device_trials
  set state = 'finalized', updated_at = clock_timestamp()
  where trial_id = onboarding_trial_id;

  return jsonb_build_object(
    'status', 'finalized',
    'ciphertext', existing_trial.result_ciphertext,
    'iv', existing_trial.result_iv
  );
end;
$$;

create function public.abandon_onboarding_device_trial(
  requested_user_id uuid,
  onboarding_trial_id uuid,
  requested_device_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := requested_user_id;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  delete from public.onboarding_device_trials
  where trial_id = onboarding_trial_id
    and user_id = requesting_user_id
    and device_token_hash = requested_device_token_hash
    and state = 'generating';
  return found;
end;
$$;

revoke all on function public.begin_onboarding_device_trial(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.store_onboarding_device_trial_result(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.finalize_onboarding_device_trial(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.abandon_onboarding_device_trial(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_onboarding_device_trial(uuid, uuid, text) to service_role;
grant execute on function public.store_onboarding_device_trial_result(uuid, uuid, text, text, text) to service_role;
grant execute on function public.finalize_onboarding_device_trial(uuid, uuid, text) to service_role;
grant execute on function public.abandon_onboarding_device_trial(uuid, uuid, text) to service_role;
