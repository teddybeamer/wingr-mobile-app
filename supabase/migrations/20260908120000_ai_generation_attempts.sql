create table public.ai_generation_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index ai_generation_attempts_user_id_attempted_at_idx
  on public.ai_generation_attempts (user_id, attempted_at);

alter table public.ai_generation_attempts enable row level security;

create function public.claim_ai_generation_attempt()
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

  perform pg_advisory_xact_lock(hashtextextended(requesting_user_id::text, 0));

  if (
    select count(*)
    from public.ai_generation_attempts
    where user_id = requesting_user_id
      and attempted_at > now() - interval '30 days'
  ) >= 500 then
    return false;
  end if;

  insert into public.ai_generation_attempts (user_id)
  values (requesting_user_id);

  return true;
end;
$$;

revoke all on table public.ai_generation_attempts from anon, authenticated;
revoke all on function public.claim_ai_generation_attempt() from public;
grant execute on function public.claim_ai_generation_attempt() to authenticated;
