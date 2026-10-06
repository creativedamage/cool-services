-- Email from Sundays.
--
-- · Sundays' relay (platform_mail): one email service (Brevo or Resend) set up by a Sundays super
--   admin. Every organization can send through it with no setup of its own.
-- · Each organization's email (mail_settings): use the relay, its own Brevo/Resend account, or
--   nothing; its reply-to address; and which request emails go out.
-- · mail_log: what was sent (or why not), shown in the organization's settings.
--
-- API keys are stored encrypted (AES-GCM, key "mail_key" in public.app_secrets, made by the ops
-- function the first time it needs it). None of these tables can be read through the public API.

create table if not exists ops.platform_mail (
  id text primary key default 'platform' check (id = 'platform'),
  provider text not null default 'brevo' check (provider in ('brevo', 'resend')),
  api_key_enc text,
  from_email text,
  from_name text not null default 'Sundays',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table ops.platform_mail enable row level security;

create table if not exists ops.mail_settings (
  org_id text primary key default ops.current_org() references ops.organization(id) on delete cascade,
  provider text not null default 'sundays' check (provider in ('sundays', 'brevo', 'resend', 'off')),
  api_key_enc text,
  from_email text,
  from_name text,
  reply_to text,
  notify_team boolean not null default true,       -- new work orders / supply requests → the handling team
  notify_approvers boolean not null default true,  -- waiting for approval → the approving team
  notify_assignee boolean not null default true,   -- assigned to you → that person
  notify_requester boolean not null default true,  -- approved, declined (with the reason), on hold, ordered, done → whoever asked
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table ops.mail_settings enable row level security;
grant select, insert, update on ops.mail_settings to ops_app;
drop policy if exists org_isolation on ops.mail_settings;
create policy org_isolation on ops.mail_settings to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org());

create table if not exists ops.mail_log (
  id text primary key default ops.id(),
  org_id text references ops.organization(id) on delete cascade,
  pco_org_id text,
  kind text not null,
  recipient text not null,
  subject text not null,
  status text not null check (status in ('SENT', 'FAILED', 'SKIPPED')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists mail_log_org on ops.mail_log (org_id, created_at desc);
create index if not exists mail_log_pco on ops.mail_log (pco_org_id, created_at desc);
alter table ops.mail_log enable row level security;
grant select on ops.mail_log to ops_app;
drop policy if exists org_isolation on ops.mail_log;
create policy org_isolation on ops.mail_log for select to ops_app using (org_id = ops.current_org());
