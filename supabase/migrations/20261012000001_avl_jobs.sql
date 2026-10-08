-- Sundays AVL, phase 1: jobs and their budgets.
--
-- · A job is the record everything after the sale hangs off. It's made from a signed (accepted)
--   proposal, which copies the proposal's lines into the job's budget, or by hand (a church team's
--   own project, no proposal at all).
-- · The budget is a tree: cost groups (Audio, Video, Labor…) holding cost items. Each item has a
--   quantity, unit, unit cost and unit price; profit and margin are worked out, never stored.
--   Later phases point purchase orders, bills and invoices at these items (committed, actual,
--   invoiced = sums over those links).
-- · avl_business.business_type: an integrator sells to clients (proposals, clients, invoices); a
--   church team runs its own projects (jobs and budgets, no selling).

alter table ops.avl_business add column if not exists business_type text not null default 'INTEGRATOR';
alter table ops.avl_business add column if not exists job_prefix text not null default 'J';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'avl_business_type_check') then
    alter table ops.avl_business add constraint avl_business_type_check check (business_type in ('INTEGRATOR', 'CHURCH'));
  end if;
end $$;
grant update (business_type, job_prefix) on ops.avl_business to ops_app;

create table if not exists ops.jobs (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  number text not null,
  name text not null,
  status text not null default 'PLANNING' check (status in ('PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETE', 'CANCELLED')),
  customer_id text references ops.customers(id) on delete set null,
  quote_id text references ops.quotes(id) on delete set null,
  campus_id text references ops.campuses(id) on delete set null,
  manager_id text references ops.users(id) on delete set null on update cascade,
  site_line1 text, site_line2 text, site_city text, site_state text, site_postal_code text,
  start_date date, end_date date,
  notes text,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists jobs_org_number on ops.jobs (org_id, number);
create unique index if not exists jobs_quote on ops.jobs (quote_id) where quote_id is not null;
create index if not exists jobs_org_status on ops.jobs (org_id, status);
create index if not exists jobs_customer on ops.jobs (customer_id);

create table if not exists ops.budget_items (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  parent_id text references ops.budget_items(id) on delete cascade,
  kind text not null default 'ITEM' check (kind in ('GROUP', 'ITEM')),
  name text not null,
  description text,
  cost_type text not null default 'MATERIAL' check (cost_type in ('MATERIAL', 'LABOR', 'SUBCONTRACT', 'OTHER')),
  quantity numeric(14, 3) not null default 1,
  unit text,
  unit_cost_cents bigint not null default 0,
  unit_price_cents bigint not null default 0,
  taxable boolean not null default true,
  product_id text references ops.products(id) on delete set null,
  quote_item_id text references ops.quote_items(id) on delete set null,
  sort_order int not null default 0
);
create index if not exists budget_items_job on ops.budget_items (job_id, sort_order);

do $$ declare t text; begin
  foreach t in array array['jobs', 'budget_items'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;
