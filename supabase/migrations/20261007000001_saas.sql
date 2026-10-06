-- Sundays | Operations as a service: many organizations, each with its own people and data.
--
--  · ops.organization becomes the organizations table (one row per church / business).
--  · Every Operations / AVL table gets org_id. The ops function runs each request as the
--    ops_app role with app.org_id set, and row-level security keeps every query inside that
--    organization (so a missed filter can't leak another org's data).
--  · ops.users rows are memberships: one per person per organization (auth_id = their sign-in).
--  · Modules, plans, platform admins (super admins), platform settings and invoices.

-- ── Part 1: role, helpers, catalog ───────────────────────────────
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ops_app') then create role ops_app nologin; end if;
end $$;
grant ops_app to current_user;
grant usage on schema ops to ops_app;

create or replace function ops.current_org() returns text language sql stable set search_path = '' as $$
  select nullif(current_setting('app.org_id', true), '')
$$;

create table if not exists ops.modules (
  key text primary key,
  name text not null,
  description text,
  price_monthly_cents int not null default 0,
  price_yearly_cents int not null default 0,
  sort_order int not null default 0,
  active boolean not null default true
);
insert into ops.modules (key, name, description, sort_order) values
  ('technology', 'Technology requests', 'Laptops, tablets, software and tech support requests.', 0),
  ('supplies', 'Supply requests', 'Restroom, janitorial, kitchen and office supplies with item lists.', 1),
  ('facilities', 'Facilities work orders', 'Repairs and building issues as work orders.', 2),
  ('campuses', 'Multiple campuses', 'More than one campus, with routing and managers per campus.', 3),
  ('branding', 'Custom branding', 'Your logo in the app and on printouts.', 4),
  ('avl', 'AVL quoting', 'Sundays | AVL: clients, quotes, vendor price lists and proposals.', 5)
on conflict (key) do nothing;

create table if not exists ops.plans (
  id text primary key default ops.id(),
  name text not null,
  tagline text,
  price_monthly_cents int not null default 0,
  price_yearly_cents int not null default 0,
  modules text[] not null default '{}',
  max_users int,
  max_campuses int,
  trial_days int not null default 14,
  public boolean not null default true,
  active boolean not null default true,
  highlight boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into ops.plans (id, name, tagline, modules, sort_order, highlight) values
  ('starter', 'Starter', 'Requests and a work queue for a small team.', '{technology}', 0, false),
  ('church', 'Church', 'Technology, supplies and facilities for every campus.', '{technology,supplies,facilities,campuses,branding}', 1, true),
  ('church-avl', 'Church + AVL', 'Everything in Church, plus AVL quoting.', '{technology,supplies,facilities,campuses,branding,avl}', 2, false)
on conflict (id) do nothing;

create table if not exists ops.platform_settings (
  id text primary key default 'platform' check (id = 'platform'),
  church_discount_bps int not null default 1500,
  default_plan_id text references ops.plans(id) on delete set null,
  trial_days int not null default 14,
  updated_at timestamptz not null default now()
);
insert into ops.platform_settings (id, default_plan_id) values ('platform', 'church') on conflict (id) do nothing;

create table if not exists ops.platform_admins (
  id text primary key default ops.id(),
  email text not null unique,          -- lowercase
  auth_id text unique,                 -- filled in when they sign in
  added_by text,
  created_at timestamptz not null default now()
);

-- ── Part 2: organizations ────────────────────────────────────────
alter table ops.organization drop constraint if exists organization_id_check;
alter table ops.organization alter column id set default ops.id();
alter table ops.organization
  add column if not exists org_type text not null default 'CHURCH' check (org_type in ('CHURCH','NONPROFIT','SCHOOL','BUSINESS')),
  add column if not exists status text not null default 'ACTIVE' check (status in ('TRIAL','ACTIVE','PAST_DUE','SUSPENDED','CANCELLED')),
  add column if not exists plan_id text references ops.plans(id) on delete set null,
  add column if not exists billing_interval text not null default 'MONTHLY' check (billing_interval in ('MONTHLY','YEARLY')),
  add column if not exists billing_email text,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists full_license boolean not null default false,
  add column if not exists module_overrides jsonb not null default '{}',
  add column if not exists church_discount boolean not null default true,
  add column if not exists discount_bps int not null default 0,
  add column if not exists discount_cents int not null default 0,
  add column if not exists discount_ends_at timestamptz,
  add column if not exists discount_note text,
  add column if not exists admin_notes text,
  add column if not exists created_by text,
  add column if not exists created_at timestamptz not null default now();
-- The church that's been using Operations so far: everything, no charge.
update ops.organization set full_license = true, plan_id = coalesce(plan_id, 'church-avl') where id = 'org';

alter table ops.avl_business drop constraint if exists avl_business_id_check;
alter table ops.avl_business alter column id drop default;
update ops.avl_business set id = 'org' where id = 'avl' and not exists (select 1 from ops.avl_business where id = 'org');
delete from ops.avl_business where id = 'avl';
alter table ops.avl_business drop constraint if exists avl_business_org_fk;
alter table ops.avl_business add constraint avl_business_org_fk foreign key (id) references ops.organization(id) on delete cascade;

-- ── Part 3: org_id on every Operations / AVL table ───────────────
do $$ declare t text; begin
  foreach t in array array['campuses','users','teams','team_members','customers','customer_contacts','vendors','products',
    'import_batches','counters','quotes','quote_items','quote_events','quote_signatures','payments','purchase_orders',
    'purchase_order_items','request_categories','category_routings','supply_items','requests','request_lines',
    'request_comments','request_events','activity_log','org_assets'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'ops' and table_name = t and column_name = 'org_id') then
      execute format('alter table ops.%I add column org_id text references ops.organization(id) on delete cascade', t);
      execute format('update ops.%I set org_id = %L', t, 'org');
      execute format('alter table ops.%I alter column org_id set not null', t);
      execute format('alter table ops.%I alter column org_id set default ops.current_org()', t);
      execute format('create index if not exists %I on ops.%I (org_id)', t || '_org_idx', t);
    end if;
  end loop;
end $$;

-- Unique within an organization (not across all of them).
alter table ops.campuses drop constraint if exists campuses_name_key, drop constraint if exists campuses_code_key;
create unique index if not exists campuses_org_name on ops.campuses (org_id, name);
create unique index if not exists campuses_org_code on ops.campuses (org_id, code);
alter table ops.teams drop constraint if exists teams_name_key;
create unique index if not exists teams_org_name on ops.teams (org_id, name);
alter table ops.vendors drop constraint if exists vendors_name_key;
create unique index if not exists vendors_org_name on ops.vendors (org_id, name);
alter table ops.quotes drop constraint if exists quotes_number_key;
create unique index if not exists quotes_org_number on ops.quotes (org_id, number);
alter table ops.purchase_orders drop constraint if exists purchase_orders_number_key;
create unique index if not exists purchase_orders_org_number on ops.purchase_orders (org_id, number);
alter table ops.request_categories drop constraint if exists request_categories_name_key;
create unique index if not exists request_categories_org_name on ops.request_categories (org_id, name);
alter table ops.requests drop constraint if exists requests_number_key;
create unique index if not exists requests_org_number on ops.requests (org_id, number);
alter table ops.org_assets drop constraint if exists org_assets_pkey;
alter table ops.org_assets add primary key (org_id, key);
alter table ops.counters drop constraint if exists counters_pkey;
alter table ops.counters add primary key (org_id, key);

-- Memberships: one row per person per organization; auth_id is their Sundays sign-in.
alter table ops.users drop constraint if exists users_email_key;
create unique index if not exists users_org_email on ops.users (org_id, email);
alter table ops.users add column if not exists auth_id text;
update ops.users set auth_id = id where registered and auth_id is null;
create index if not exists users_auth_idx on ops.users (auth_id);
alter table ops.users drop constraint if exists users_source_check;
alter table ops.users add constraint users_source_check check (source in ('MANUAL','GOOGLE','ENTRA','PLATFORM'));

-- ── Part 4: invoices ─────────────────────────────────────────────
create sequence if not exists ops.invoice_seq;
create table if not exists ops.invoices (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  number text not null unique,
  period text,                         -- 'YYYY-MM' (or 'YYYY' for yearly)
  description text,
  lines jsonb not null default '[]',   -- [{label, amountCents}]
  subtotal_cents int not null default 0,
  discount_cents int not null default 0,
  total_cents int not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT','SENT','PAID','VOID')),
  due_at date,
  sent_at timestamptz, paid_at timestamptz,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists invoices_org_idx on ops.invoices (org_id, created_at);
create unique index if not exists invoices_org_period on ops.invoices (org_id, period) where status <> 'VOID' and period is not null;

-- ── Part 5: row-level security for the ops_app role ──────────────
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'ops' loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('drop policy if exists org_isolation on ops.%I', t);
    execute format('drop policy if exists org_read on ops.%I', t);
  end loop;
  foreach t in array array['campuses','users','teams','team_members','customers','customer_contacts','vendors','products',
    'import_batches','counters','quotes','quote_items','quote_events','quote_signatures','payments','purchase_orders',
    'purchase_order_items','request_categories','category_routings','supply_items','requests','request_lines',
    'request_comments','request_events','activity_log','org_assets','invoices'] loop
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
  end loop;
  -- Their own organization row and AVL settings.
  foreach t in array array['organization','avl_business'] loop
    execute format('grant select, insert, update on ops.%I to ops_app', t);
    execute format('create policy org_isolation on ops.%I to ops_app using (id = ops.current_org()) with check (id = ops.current_org())', t);
  end loop;
  -- The catalog is readable by everyone signed in (changed only by platform admins).
  foreach t in array array['plans','modules','platform_settings'] loop
    execute format('grant select on ops.%I to ops_app', t);
    execute format('create policy org_read on ops.%I for select to ops_app using (true)', t);
  end loop;
end $$;
-- ops_app may only change the organization's own details, not its plan or billing.
revoke update on ops.organization from ops_app;
grant update (name, legal_name, address_line1, address_line2, city, state, postal_code, country, phone, email, website, ein,
  sales_tax_id, tax_exempt, quote_prefix, billing_email, updated_at, default_tax_bps, default_deposit_bps, default_margin_bps,
  labor_rate_cents, quote_valid_days, quote_terms) on ops.organization to ops_app;
revoke insert on ops.organization from ops_app;
grant execute on function ops.id() to ops_app;
grant execute on function ops.current_org() to ops_app;
alter default privileges in schema ops revoke all on tables from public, anon, authenticated;

-- ── Part 6: sign-ups and new organizations ───────────────────────
-- A new sign-in claims every invitation (membership added by email) waiting for that address.
create or replace function ops.on_auth_user() returns trigger language plpgsql security definer set search_path = ops, public as $$
begin
  if new.email is null then return new; end if;
  update ops.users set auth_id = new.id::text, registered = true, updated_at = now()
    where email = lower(new.email) and auth_id is null;
  update ops.platform_admins set auth_id = new.id::text where email = lower(new.email) and auth_id is null;
  return new;
end $$;
revoke all on function ops.on_auth_user() from public, anon, authenticated;

-- What a new organization starts with: a campus and the usual request types and supply lists.
create or replace function ops.seed_org(o text) returns void language plpgsql set search_path = ops, public as $$
begin
  insert into ops.campuses (org_id, name, code, sort_order) values (o, 'Main campus', 'MAIN', 0) on conflict do nothing;
  insert into ops.request_categories (org_id, name, icon, kind, workflow, description, approval_threshold_cents, requires_location, allow_line_items, sort_order) values
    (o, 'Laptop', 'i:laptop', 'TECHNOLOGY', 'APPROVAL', 'New or replacement laptop', null, false, false, 0),
    (o, 'iPad / Tablet', 'i:tablet', 'TECHNOLOGY', 'APPROVAL', 'iPads for ministry, check-in, or production', null, false, false, 1),
    (o, 'Software & licenses', 'i:list', 'TECHNOLOGY', 'APPROVAL', 'Apps, subscriptions, seats', null, false, false, 2),
    (o, 'Tech accessories', 'i:cable', 'TECHNOLOGY', 'FULFILLMENT', 'Chargers, cables, keyboards, cases', 10000, false, false, 3),
    (o, 'Tech support', 'i:help', 'TECHNOLOGY', 'WORK_ORDER', 'Something broken or not working', null, false, false, 4),
    (o, 'Restroom supplies', 'i:bath', 'SUPPLY', 'FULFILLMENT', 'Paper towels, toilet paper, soap', 25000, true, true, 5),
    (o, 'Janitorial & cleaning', 'i:spray', 'SUPPLY', 'FULFILLMENT', 'Cleaners, wipes, trash bags', 25000, false, true, 6),
    (o, 'Kitchen & breakroom', 'i:coffee', 'SUPPLY', 'FULFILLMENT', 'Coffee, cups, plates, utensils', 25000, false, true, 7),
    (o, 'Office supplies', 'i:pkg', 'SUPPLY', 'FULFILLMENT', 'Paper, pens, toner', 25000, false, true, 8),
    (o, 'Plumbing', 'i:water', 'MAINTENANCE', 'WORK_ORDER', 'Leaks, clogs, toilets, sinks, water fountains', null, true, false, 9),
    (o, 'Electrical & lighting', 'i:bulb', 'MAINTENANCE', 'WORK_ORDER', 'Outlets, breakers, bulbs, fixtures', null, true, false, 10),
    (o, 'HVAC / temperature', 'i:temp', 'MAINTENANCE', 'WORK_ORDER', 'Too hot, too cold, noisy units', null, true, false, 11),
    (o, 'Doors, locks & keys', 'i:key', 'MAINTENANCE', 'WORK_ORDER', 'Door hardware, re-keying, access', null, true, false, 12),
    (o, 'General repair', 'i:wrench', 'MAINTENANCE', 'WORK_ORDER', 'Anything else in the building', null, true, false, 13),
    (o, 'Something else', 'i:tag', 'OTHER', 'WORK_ORDER', 'Anything that doesn''t fit above', null, false, false, 14)
  on conflict do nothing;
  insert into ops.supply_items (org_id, category_id, name, unit, unit_cost_cents, sort_order)
  select o, c.id, v.name, v.unit, v.cost, v.ord from ops.request_categories c join (values
    ('Restroom supplies', 'Paper towels (multifold)', 'case', 4200, 0), ('Restroom supplies', 'Toilet paper (jumbo roll)', 'case', 5500, 1),
    ('Restroom supplies', 'Hand soap refill', 'case', 3800, 2),
    ('Janitorial & cleaning', 'Disinfectant wipes', 'case', 4800, 0), ('Janitorial & cleaning', 'Trash bags (55 gal)', 'case', 3600, 1),
    ('Kitchen & breakroom', 'Coffee (ground, 2 lb)', 'bag', 1800, 0), ('Kitchen & breakroom', 'Hot cups (12 oz)', 'case', 4500, 1),
    ('Office supplies', 'Copy paper (letter)', 'case', 4900, 0), ('Office supplies', 'Pens (black)', 'box', 800, 1)
  ) as v(cat, name, unit, cost, ord) on v.cat = c.name
  where c.org_id = o;
end $$;
revoke all on function ops.seed_org(text) from public, anon, authenticated;
