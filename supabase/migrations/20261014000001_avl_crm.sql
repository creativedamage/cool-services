-- Sundays AVL, phase 2: CRM — leads, and activity (notes, calls, follow-ups) on every record.
--
-- · A lead is a possible job: a church (a client already, or just a name and a contact so far),
--   what they want, roughly what it's worth, where it came from and who owns it. It moves through
--   stages on a board: New → Contacted → Site visit → Proposal → Won / Lost. Starting a proposal
--   makes the client if needed; winning makes the job.
-- · An activity is something that happened or needs to happen, on a lead, a client or a job: a note,
--   call, email, meeting or site visit, or a follow-up (anything with a due date; done when ticked).
--   Stage changes are recorded as activities too, so a lead's timeline is its whole history.

create table if not exists ops.leads (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  title text not null,
  stage text not null default 'NEW' check (stage in ('NEW', 'CONTACTED', 'SITE_VISIT', 'PROPOSAL', 'WON', 'LOST')),
  -- A client already, or the prospect's own details until it becomes one.
  customer_id text references ops.customers(id) on delete set null,
  org_name text, contact_name text, contact_email text, contact_phone text, city text, state text,
  value_cents bigint not null default 0,
  source text,
  owner_id text references ops.users(id) on delete set null on update cascade,
  expected_close date,
  quote_id text references ops.quotes(id) on delete set null,
  job_id text references ops.jobs(id) on delete set null,
  lost_reason text,
  notes text,
  position double precision not null default 0,
  won_at timestamptz, lost_at timestamptz,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_org_stage on ops.leads (org_id, stage, position);
create index if not exists leads_customer on ops.leads (customer_id);
create index if not exists leads_quote on ops.leads (quote_id);

create table if not exists ops.activities (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  kind text not null default 'NOTE' check (kind in ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'TASK', 'STAGE')),
  body text not null default '',
  lead_id text references ops.leads(id) on delete cascade,
  customer_id text references ops.customers(id) on delete cascade,
  job_id text references ops.jobs(id) on delete cascade,
  -- A follow-up: due_at set; done once done_at is.
  due_at timestamptz,
  done_at timestamptz,
  assigned_to_id text references ops.users(id) on delete set null on update cascade,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or customer_id is not null or job_id is not null)
);
create index if not exists activities_lead on ops.activities (lead_id, created_at);
create index if not exists activities_customer on ops.activities (customer_id, created_at);
create index if not exists activities_job on ops.activities (job_id, created_at);
create index if not exists activities_open on ops.activities (org_id, due_at) where due_at is not null and done_at is null;

do $$ declare t text; begin
  foreach t in array array['leads', 'activities'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;
