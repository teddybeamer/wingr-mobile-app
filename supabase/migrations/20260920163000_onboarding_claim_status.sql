create function public.has_claimed_onboarding_ai_reply()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.onboarding_ai_reply_claims
    where user_id = requesting_user_id
  );
end;
$$;

revoke all on function public.has_claimed_onboarding_ai_reply()
  from public, anon;
grant execute on function public.has_claimed_onboarding_ai_reply()
  to authenticated;
