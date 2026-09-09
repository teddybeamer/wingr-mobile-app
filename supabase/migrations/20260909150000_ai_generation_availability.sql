-- Preserve the original RPCs for older deployed functions.
create or replace function public.claim_ai_generation_attempt_with_availability(is_onboarding boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claim_status text;
  retry_at timestamptz;
begin
  -- These functions authenticate the caller and hold the same per-user
  -- transaction lock through the availability lookup below.
  if is_onboarding then
    claim_status := public.claim_onboarding_ai_generation_attempt();
  elsif public.claim_ai_generation_attempt() then
    claim_status := 'allowed';
  else
    claim_status := 'usage_limit';
  end if;

  if claim_status = 'usage_limit' then
    select attempted_at + interval '30 days' into retry_at
    from public.ai_generation_attempts
    where user_id = auth.uid()
      and attempted_at > now() - interval '30 days'
    order by attempted_at desc
    offset 499 limit 1;
  end if;

  return jsonb_build_object('status', claim_status, 'retryAt', retry_at);
end;
$$;

revoke all on function public.claim_ai_generation_attempt_with_availability(boolean) from public, anon;
grant execute on function public.claim_ai_generation_attempt_with_availability(boolean) to authenticated;
