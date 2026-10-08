-- Sundays AVL, phase 4: running the job.
--
-- · Phases: the job's schedule (Design, Order, Pre-wire, Install…), each a bar on the Gantt with
--   start and end dates and the people on it. The all-jobs calendar is these bars.
-- · Crew: the people on a job. An AVL Crew member (users.avl_level = 'CREW') sees only the jobs
--   they're on, and never prices or the budget.
-- · Tasks: to-dos per job (optionally per phase), with an assignee, a due date and a checklist.
-- · Daily logs: what happened on site each day: notes, issues, hours, photos.
-- · Files: drawings, rack elevations, photos, closeout documents (kept in Storage, bucket job-files).
-- · Time: hours per person per job (clocked in and out, or typed in), costed at the person's rate.

-- AVL Crew: below AVL Tech.
alter table ops.users drop constraint if exists users_avl_level_check;
alter table ops.users add constraint users_avl_level_check check (avl_level in ('NONE', 'CREW', 'TECH', 'MANAGER'));
alter table ops.users drop constraint if exists users_synced_avl_level_check;
alter table ops.users add constraint users_synced_avl_level_check check (synced_avl_level in ('NONE', 'CREW', 'TECH', 'MANAGER'));
-- What an hour of this person's time costs the business (for job costing).
alter table ops.users add column if not exists hourly_cost_cents int check (hourly_cost_cents is null or hourly_cost_cents between 0 and 100000000);

create table if not exists ops.job_phases (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'IN_PROGRESS', 'DONE')),
  color text,
  notes text,
  people text[] not null default '{}',
  sort_order int not null default 0,
  check (end_date is null or start_date is null or end_date >= start_date)
);
create index if not exists job_phases_job on ops.job_phases (job_id, sort_order);
create index if not exists job_phases_dates on ops.job_phases (org_id, start_date, end_date);

create table if not exists ops.job_crew (
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  user_id text not null references ops.users(id) on delete cascade on update cascade,
  added_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index if not exists job_crew_user on ops.job_crew (user_id);

create table if not exists ops.job_tasks (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  phase_id text references ops.job_phases(id) on delete set null,
  title text not null,
  notes text,
  assignee_id text references ops.users(id) on delete set null on update cascade,
  due_date date,
  -- [{ "id": "…", "text": "…", "done": true }]
  checklist jsonb not null default '[]',
  done_at timestamptz,
  done_by_id text references ops.users(id) on delete set null on update cascade,
  sort_order int not null default 0,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_tasks_job on ops.job_tasks (job_id, sort_order);
create index if not exists job_tasks_assignee on ops.job_tasks (assignee_id) where done_at is null;

create table if not exists ops.daily_logs (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  log_date date not null,
  author_id text references ops.users(id) on delete set null on update cascade,
  notes text not null default '',
  issues text,
  crew_count int,
  hours_on_site numeric(6, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists daily_logs_job on ops.daily_logs (job_id, log_date desc);

create table if not exists ops.job_files (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  daily_log_id text references ops.daily_logs(id) on delete cascade,
  folder text,
  name text not null,
  path text not null,
  mime text,
  size_bytes bigint not null default 0,
  -- Uploaded and confirmed (a file whose upload never finished stays false and is cleaned up).
  ready boolean not null default false,
  -- For the client portal (billing phase).
  shared boolean not null default false,
  uploaded_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now()
);
create index if not exists job_files_job on ops.job_files (job_id, created_at desc);
create index if not exists job_files_log on ops.job_files (daily_log_id);

create table if not exists ops.time_entries (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  phase_id text references ops.job_phases(id) on delete set null,
  user_id text not null references ops.users(id) on delete cascade on update cascade,
  work_date date not null,
  -- A running clock has started_at and no ended_at (minutes 0 until it stops).
  started_at timestamptz,
  ended_at timestamptz,
  minutes int not null default 0 check (minutes between 0 and 1440),
  note text,
  -- The person's hourly cost when the time was logged.
  cost_rate_cents int not null default 0,
  approved_at timestamptz,
  approved_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists time_entries_job on ops.time_entries (job_id, work_date desc);
create index if not exists time_entries_user on ops.time_entries (user_id, work_date desc);
-- One running clock per person.
create unique index if not exists time_entries_running on ops.time_entries (user_id) where started_at is not null and ended_at is null;

do $$ declare t text; begin
  foreach t in array array['job_phases', 'job_crew', 'job_tasks', 'daily_logs', 'job_files', 'time_entries'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;

-- Files live in a private Storage bucket; the ops function hands out short-lived signed links.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit) values ('job-files', 'job-files', false, 104857600)
    on conflict (id) do nothing;
  end if;
end $$;
