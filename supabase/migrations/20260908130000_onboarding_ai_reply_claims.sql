create table public.onboarding_ai_reply_claims (
  user_id uuid primary key references auth.users (id) on delete cascade,
  claimed_at timestamptz not null default now()
);

alter table public.onboarding_ai_reply_claims enable row level security;

create function public.claim_onboarding_ai_generation_attempt()
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

  if (
    select count(*)
    from public.ai_generation_attempts
    where user_id = requesting_user_id
      and attempted_at > now() - interval '30 days'
  ) >= 500 then
    return 'usage_limit';
  end if;

  insert into public.onboarding_ai_reply_claims (user_id)
  values (requesting_user_id);

  insert into public.ai_generation_attempts (user_id)
  values (requesting_user_id);

  return 'allowed';
end;
$$;

revoke all on table public.onboarding_ai_reply_claims from anon, authenticated;
revoke all on function public.claim_onboarding_ai_generation_attempt() from public;
grant execute on function public.claim_onboarding_ai_generation_attempt() to authenticated;
