-- Sundays AVL, phase 3: estimating.
--
-- · Labor rates: install, programming, travel… each with a cost (what it costs you) and a price.
-- · Markup rules: the margin a product gets when it's added from a price list, by manufacturer,
--   category or vendor (the most specific rule wins; otherwise the business's default margin).
-- · Kits (assemblies): a saved set of products, labor and custom lines, added to a proposal or a
--   job budget in one go.
-- · Options on a proposal: an optional add-on the client can tick, or alternates (Good / Better /
--   Best) where the client picks one. quote_items.selected is what's in the total.
-- · Versions: every time a proposal is sent, what the client saw is kept (v1, v2…).

create table if not exists ops.labor_rates (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  name text not null,
  description text,
  unit text not null default 'hr',
  cost_cents int not null default 0,
  price_cents int not null default 0,
  taxable boolean not null default false,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists labor_rates_org on ops.labor_rates (org_id, sort_order);

create table if not exists ops.markup_rules (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  manufacturer text,
  category text,
  vendor_id text references ops.vendors(id) on delete cascade,
  margin_bps int not null check (margin_bps >= 0 and margin_bps < 10000),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists markup_rules_org on ops.markup_rules (org_id, sort_order);

create table if not exists ops.assemblies (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  name text not null,
  description text,
  section text,
  active boolean not null default true,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assemblies_org on ops.assemblies (org_id, name);

create table if not exists ops.assembly_items (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  assembly_id text not null references ops.assemblies(id) on delete cascade,
  kind text not null default 'CUSTOM' check (kind in ('PRODUCT', 'LABOR', 'CUSTOM')),
  product_id text references ops.products(id) on delete set null,
  labor_rate_id text references ops.labor_rates(id) on delete set null,
  name text not null,
  description text,
  quantity int not null default 1 check (quantity > 0),
  -- Custom lines keep their own cost and price; products and labor follow the price list / rate.
  unit_cost_cents int not null default 0,
  unit_price_cents int,
  taxable boolean not null default true,
  sort_order int not null default 0
);
create index if not exists assembly_items_assembly on ops.assembly_items (assembly_id, sort_order);

alter table ops.quote_items add column if not exists option_group text;
alter table ops.quote_items add column if not exists option_choice text;
alter table ops.quote_items add column if not exists selected boolean not null default true;
alter table ops.quote_items add column if not exists kit_name text;
alter table ops.quotes add column if not exists version int not null default 1;

create table if not exists ops.quote_versions (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  quote_id text not null references ops.quotes(id) on delete cascade,
  version int not null,
  sent_at timestamptz not null default now(),
  sent_by_id text references ops.users(id) on delete set null on update cascade,
  total_cents bigint not null,
  snapshot jsonb not null,
  unique (quote_id, version)
);

do $$ declare t text; begin
  foreach t in array array['labor_rates', 'markup_rules', 'assemblies', 'assembly_items', 'quote_versions'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;
