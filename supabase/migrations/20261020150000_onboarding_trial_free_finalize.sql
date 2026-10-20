-- The free onboarding reply must not reduce the Weekly or Monthly allowance.
--
-- finalize_onboarding_device_trial (unchanged, still used by the original
-- endpoint) records an ai_generation_attempts row for the free reply, and the plan
-- limits count that table. This v2 variant is the same function without that
-- insert: finalizing still makes the one account claim, and the DeviceCheck bit
-- (set by the caller before finalizing) still limits the device to one reply.
--
-- Additive only: no existing function or grant changes.

create function public.finalize_onboarding_device_trial_v2(
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
  -- Same per-user lock as the original, so parallel finalizations still serialize.
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

revoke all on function public.finalize_onboarding_device_trial_v2(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_onboarding_device_trial_v2(uuid, uuid, text) to service_role;
