-- Team check-ins on the website (sundays-checkin.vercel.app).
--
-- · People sign in with their own Planning Center account. Everything they see comes from
--   Planning Center with their own access; Sundays decides whether they may use check-ins at all
--   (ops.users.checkin_level), so a church can give someone check-ins and nothing else.
-- · An organization is linked to its Planning Center organization (pco_org_id) the first time one
--   of its System admins signs in to check-ins.
-- · Settings (each service type's volunteer event, each team's area of serving, ministries) and
--   staff check-ins live here, per organization. Planning Center's Check-Ins API can't create
--   check-ins, so staff check-ins are Sundays' own, as on the Mac.
-- · Sessions keep each person's Planning Center tokens, encrypted (AES-GCM, key "checkin_key" in
--   public.app_secrets). None of these tables can be read through the public API.

alter table ops.organization add column if not exists pco_org_id text;
alter table ops.organization add column if not exists pco_org_name text;
create unique index if not exists organization_pco_org on ops.organization (pco_org_id) where pco_org_id is not null;

-- NONE · VIEW (see teams and who's in) · CHECKIN (+ check people in) · MANAGER (+ check-in settings).
alter table ops.users add column if not exists checkin_level text not null default 'NONE';
alter table ops.users drop constraint if exists users_checkin_level_check;
alter table ops.users add constraint users_checkin_level_check check (checkin_level in ('NONE', 'VIEW', 'CHECKIN', 'MANAGER'));

create table if not exists ops.checkin_settings (
  org_id text primary key default ops.current_org() references ops.organization(id) on delete cascade,
  events jsonb not null default '{}',          -- serviceTypeId → { id, name } (Check-Ins event)
  team_locations jsonb not null default '{}',  -- teamId → { id, name } (location in that event)
  groups jsonb not null default '[]',          -- [{ id, name, teamIds }] ministries
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table ops.checkin_settings enable row level security;
grant select, insert, update on ops.checkin_settings to ops_app;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = 'checkin_settings' and policyname = 'org_isolation') then
    create policy org_isolation on ops.checkin_settings to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org());
  end if;
end $$;

create table if not exists ops.staff_checkins (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  person_id text not null,          -- Planning Center person
  name text not null,
  plan_id text not null,
  service_type_id text not null,
  team_id text not null,
  at timestamptz not null default now(),
  by_name text not null,            -- who checked them in (their Planning Center name)
  by_user_id text references ops.users(id) on delete set null,
  by_pco_person_id text,
  event_id text, event_name text,
  location_id text, location_name text
);
create index if not exists staff_checkins_plan on ops.staff_checkins (org_id, plan_id);
create index if not exists staff_checkins_at on ops.staff_checkins (org_id, at);
alter table ops.staff_checkins enable row level security;
grant select, insert, delete on ops.staff_checkins to ops_app;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = 'staff_checkins' and policyname = 'org_isolation') then
    create policy org_isolation on ops.staff_checkins to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org());
  end if;
end $$;

create table if not exists ops.checkin_sessions (
  token_hash text primary key,      -- sha-256 of the token the phone keeps
  org_id text not null references ops.organization(id) on delete cascade,
  user_id text not null references ops.users(id) on delete cascade,
  pco_person_id text not null,
  pco_org_id text not null,
  name text not null,
  avatar_url text,
  access_enc text not null,
  refresh_enc text,
  access_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists checkin_sessions_user on ops.checkin_sessions (user_id);
alter table ops.checkin_sessions enable row level security;

-- Sign-in handoff for phones: on an iPhone, a check-in app saved to the home screen opens
-- Planning Center's sign-in in a separate browser view with its own storage. That view leaves the
-- code here (for 10 minutes) and the app, which holds the PKCE verifier, picks it up. The code is
-- useless without the verifier.
create table if not exists ops.checkin_handoffs (
  state_hash text primary key,
  code text not null,
  redirect_uri text not null,
  created_at timestamptz not null default now()
);
alter table ops.checkin_handoffs enable row level security;
