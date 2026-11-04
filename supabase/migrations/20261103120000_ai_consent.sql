-- Explicit consent to share screenshots with AI providers (App Store Review
-- Guidelines 5.1.1(i) and 5.1.2(i)).
--
-- Additive only: no existing table, function or grant changes.
--
-- One row per user records what was accepted: the consent version and the
-- recipients named in the consent text. The AI endpoints refuse to send a
-- screenshot unless the row exists, is not withdrawn and matches the version
-- and recipients that the deployed function currently requires, so changing
-- either in the function re-asks every user without touching this table.
--
-- Who can do what:
--   read      get_ai_consent()      the signed-in user, their own row only
--   write     record_ai_consent()   service role only (the ai-consent edge
--   withdraw  withdraw_ai_consent() function, after verifying the user's token)
-- The client therefore cannot write or forge a consent row, and cannot choose
-- the version, the recipients or the timestamp: the edge function supplies the
-- first two from its own configuration and the database stamps the time.

create table public.ai_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 64),
  recipients text not null check (char_length(recipients) between 1 and 200),
  granted_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.ai_consents enable row level security;
revoke all on table public.ai_consents from public, anon, authenticated;

create function public.get_ai_consent()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requesting_user_id uuid := auth.uid();
  stored public.ai_consents%rowtype;
begin
  if requesting_user_id is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;

  select * into stored
  from public.ai_consents
  where user_id = requesting_user_id;

  if not found then
    return jsonb_build_object('granted', false);
  end if;

  return jsonb_build_object(
    'granted', stored.withdrawn_at is null,
    'version', stored.consent_version,
    'recipients', stored.recipients
  );
end;
$$;

create function public.record_ai_consent(
  target_user_id uuid,
  requested_version text,
  requested_recipients text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_user_id is null
     or requested_version is null
     or requested_recipients is null then
    raise exception 'A user, version and recipients are required.' using errcode = '22023';
  end if;

  insert into public.ai_consents (user_id, consent_version, recipients)
  values (target_user_id, requested_version, requested_recipients)
  on conflict (user_id) do update
    set consent_version = excluded.consent_version,
        recipients = excluded.recipients,
        granted_at = clock_timestamp(),
        withdrawn_at = null,
        updated_at = clock_timestamp();
end;
$$;

create function public.withdraw_ai_consent(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_user_id is null then
    raise exception 'A user is required.' using errcode = '22023';
  end if;

  update public.ai_consents
  set withdrawn_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = target_user_id
    and withdrawn_at is null;
end;
$$;

revoke all on function public.get_ai_consent() from public, anon;
revoke all on function public.record_ai_consent(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.withdraw_ai_consent(uuid)
  from public, anon, authenticated;
grant execute on function public.get_ai_consent() to authenticated;
grant execute on function public.record_ai_consent(uuid, text, text) to service_role;
grant execute on function public.withdraw_ai_consent(uuid) to service_role;
