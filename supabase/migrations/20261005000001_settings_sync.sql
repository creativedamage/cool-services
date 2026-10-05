-- Sundays settings sync: each Planning Center person's Sundays settings, so every Mac they sign in
-- on gets the same setup. Only the sundays-sync Edge Function (service role) reads or writes it;
-- it checks the Planning Center sign-in on every call. Values are encrypted (AES-GCM) by the function.
create table if not exists public.sync_settings (
  org_id     text        not null,
  person_id  text        not null,
  key        text        not null,
  value_enc  text        not null,
  updated_at timestamptz not null,
  device     text,
  primary key (org_id, person_id, key)
);
create index if not exists sync_settings_changed on public.sync_settings (org_id, person_id, updated_at);
alter table public.sync_settings enable row level security;
revoke all on public.sync_settings from anon, authenticated;

-- Keys only the Edge Functions use (service role). No policies: nobody else can read them.
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value)
  values ('sync_key', encode(extensions.gen_random_bytes(32), 'base64'))
  on conflict (name) do nothing;
