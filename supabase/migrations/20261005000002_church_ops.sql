-- Church Ops inside Sundays: request hub (technology, supplies, facilities work orders), AVL quoting,
-- vendors & price lists, and the people/teams/campuses that run them.
--
-- Everything lives in the "ops" schema, which the public API doesn't expose: only the "ops" Edge
-- Function reads and writes it (with the database connection), and it checks the signed-in
-- Supabase user's access level on every call. RLS is on for every table with no policies, so even a
-- mistakenly exposed table returns nothing.
--
-- Money is integer cents; percentages are basis points (1% = 100).

create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create or replace function ops.id() returns text language sql volatile set search_path = '' as $$ select replace(gen_random_uuid()::text, '-', '') $$;

-- ── Organization (one row, id 'org') ─────────────────────────────
create table ops.organization (
  id text primary key default 'org' check (id = 'org'),
  name text,                       -- filled from Planning Center the first time Sundays opens Church Ops
  legal_name text, address_line1 text, address_line2 text, city text, state text, postal_code text,
  country text default 'US', phone text, email text, website text, ein text, sales_tax_id text,
  tax_exempt boolean not null default false,
  default_tax_bps int not null default 700,
  default_deposit_bps int not null default 5000,
  default_margin_bps int not null default 3000,
  labor_rate_cents int not null default 8500,
  quote_valid_days int not null default 30,
  quote_terms text,
  quote_prefix text not null default 'CC',
  updated_at timestamptz not null default now()
);
insert into ops.organization (id, quote_terms) values ('org',
  'Pricing valid through the date shown. 50% deposit due at approval; balance due on completion. Equipment remains property of vendor until paid in full.');

create table ops.org_assets (
  key text primary key,            -- 'logo' (light backgrounds) | 'logo-dark'
  mime text not null,
  data_b64 text not null,
  updated_at timestamptz not null default now()
);

-- ── Campuses ─────────────────────────────────────────────────────
create table ops.campuses (
  id text primary key default ops.id(),
  name text not null unique,
  code text not null unique,
  address_line1 text, address_line2 text, city text, state text, postal_code text, phone text,
  timezone text not null default 'America/New_York',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── People & access ──────────────────────────────────────────────
-- id is the Supabase Auth user id once they've registered. Someone a manager adds before they
-- register gets a placeholder id; registering with that email takes the row over (pre-approved).
create table ops.users (
  id text primary key default ops.id(),
  email text not null unique,      -- lowercase
  name text not null,
  title text, department text, phone text,
  active boolean not null default false,
  pending boolean not null default true,    -- registered, waiting for a manager to approve
  registered boolean not null default false, -- has a Sundays (Supabase) sign-in
  deactivated_by text,
  campus_id text references ops.campuses(id) on delete set null,
  all_campuses boolean not null default false,
  role text not null default 'STAFF' check (role in ('STAFF','MANAGER','EXECUTIVE','ADMIN')),
  avl_level text not null default 'NONE' check (avl_level in ('NONE','TECH','MANAGER')),
  -- Directory sync (Google Workspace / Entra ID) comes later; these keep its place.
  synced_role text check (synced_role in ('STAFF','MANAGER','EXECUTIVE','ADMIN')),
  synced_avl_level text check (synced_avl_level in ('NONE','TECH','MANAGER')),
  source text not null default 'MANUAL' check (source in ('MANUAL','GOOGLE','ENTRA')),
  external_id text,
  approved_by text,
  approved_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ops.users (campus_id);

create table ops.teams (
  id text primary key default ops.id(),
  name text not null unique,
  description text,
  campus_id text references ops.campuses(id) on delete set null,   -- null = all campuses
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table ops.team_members (
  team_id text not null references ops.teams(id) on delete cascade,
  user_id text not null references ops.users(id) on delete cascade on update cascade,
  is_lead boolean not null default false,
  synced boolean not null default false,
  primary key (team_id, user_id)
);

-- ── Customers, vendors, catalog ──────────────────────────────────
create table ops.customers (
  id text primary key default ops.id(),
  name text not null,
  contact_name text, email text, phone text,
  address_line1 text, address_line2 text, city text, state text, postal_code text,
  tax_exempt boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ops.customers (name);

create table ops.vendors (
  id text primary key default ops.id(),
  name text not null unique,
  account_no text, rep_name text, rep_email text, rep_phone text, website text, terms text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.products (
  id text primary key default ops.id(),
  vendor_id text not null references ops.vendors(id) on delete cascade,
  sku text not null,
  model text, name text not null, manufacturer text, category text, description text,
  cost_cents int not null,
  msrp_cents int, map_cents int,
  active boolean not null default true,
  last_import_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, sku)
);
create index on ops.products (sku);
create index on ops.products (name);

create table ops.import_batches (
  id text primary key default ops.id(),
  vendor_id text not null references ops.vendors(id) on delete cascade,
  uploaded_by_id text not null references ops.users(id) on update cascade,
  file_name text not null,
  status text not null default 'PREVIEW' check (status in ('PREVIEW','COMMITTED','FAILED')),
  row_count int not null default 0, created int not null default 0, updated int not null default 0, skipped int not null default 0,
  errors jsonb,
  created_at timestamptz not null default now()
);

-- ── Quotes ───────────────────────────────────────────────────────
create table ops.counters (key text primary key, value int not null default 0);

create table ops.quotes (
  id text primary key default ops.id(),
  number text not null unique,
  title text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','SENT','ACCEPTED','CHANGES_REQUESTED','DECLINED','CONVERTED')),
  customer_id text not null references ops.customers(id),
  created_by_id text not null references ops.users(id) on update cascade,
  campus_id text references ops.campuses(id) on delete set null,
  intro_notes text, internal_notes text, terms text,
  tax_bps int not null default 0,
  discount_cents int not null default 0,
  deposit_bps int not null default 5000,
  valid_until timestamptz,
  public_token text not null unique,
  token_expires_at timestamptz,
  sent_subtotal_cents int, sent_tax_cents int, sent_total_cents int, sent_deposit_cents int,
  sent_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, declined_at timestamptz, converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ops.quotes (status);
create index on ops.quotes (customer_id);

create table ops.quote_items (
  id text primary key default ops.id(),
  quote_id text not null references ops.quotes(id) on delete cascade,
  product_id text references ops.products(id) on delete set null,
  is_custom boolean not null default false,
  section text, sku text, name text not null, description text,
  quantity int not null default 1,
  unit_cost_cents int not null default 0,
  unit_price_cents int not null default 0,
  taxable boolean not null default true,
  sort_order int not null default 0
);
create index on ops.quote_items (quote_id);

create table ops.quote_events (
  id text primary key default ops.id(),
  quote_id text not null references ops.quotes(id) on delete cascade,
  type text not null,
  from_status text, to_status text,
  actor_id text references ops.users(id) on delete set null on update cascade,
  actor_label text, note text,
  created_at timestamptz not null default now()
);
create index on ops.quote_events (quote_id, created_at);

-- For customer sign-and-pay links later (not used yet).
create table ops.quote_signatures (
  id text primary key default ops.id(),
  quote_id text not null unique references ops.quotes(id) on delete cascade,
  signer_name text not null, signer_email text not null, signer_title text,
  image_data_url text not null,
  total_cents_at_signing int not null,
  ip_address text, user_agent text,
  signed_at timestamptz not null default now()
);
create table ops.payments (
  id text primary key default ops.id(),
  quote_id text not null references ops.quotes(id) on delete cascade,
  provider text not null,
  provider_ref text unique,
  amount_cents int not null,
  status text not null default 'PENDING' check (status in ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ops.purchase_orders (
  id text primary key default ops.id(),
  number text not null unique,
  vendor_id text not null references ops.vendors(id),
  quote_id text references ops.quotes(id) on delete set null,
  created_by_id text not null references ops.users(id) on update cascade,
  status text not null default 'DRAFT' check (status in ('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED')),
  ordered_at timestamptz,
  created_at timestamptz not null default now()
);
create table ops.purchase_order_items (
  id text primary key default ops.id(),
  po_id text not null references ops.purchase_orders(id) on delete cascade,
  sku text, name text not null, quantity int not null, unit_cost_cents int not null, received_qty int not null default 0
);

-- ── Request hub ──────────────────────────────────────────────────
create table ops.request_categories (
  id text primary key default ops.id(),
  name text not null unique,
  kind text not null check (kind in ('TECHNOLOGY','SUPPLY','MAINTENANCE','OTHER')),
  workflow text not null check (workflow in ('APPROVAL','FULFILLMENT','WORK_ORDER')),
  description text, icon text,
  approval_threshold_cents int,
  requires_location boolean not null default false,
  allow_line_items boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table ops.category_routings (
  id text primary key default ops.id(),
  category_id text not null references ops.request_categories(id) on delete cascade,
  campus_id text references ops.campuses(id) on delete cascade,   -- null = fallback for other campuses
  handler_team_id text not null references ops.teams(id) on delete cascade,
  approver_team_id text references ops.teams(id) on delete set null
);
create unique index category_routings_one on ops.category_routings (category_id, coalesce(campus_id, ''));

create table ops.supply_items (
  id text primary key default ops.id(),
  category_id text not null references ops.request_categories(id) on delete cascade,
  name text not null, unit text not null default 'each', sku text,
  unit_cost_cents int,
  active boolean not null default true,
  sort_order int not null default 0
);

create table ops.requests (
  id text primary key default ops.id(),
  number text not null unique,
  requester_id text not null references ops.users(id) on update cascade,
  category_id text not null references ops.request_categories(id),
  campus_id text not null references ops.campuses(id),
  location text,
  title text not null,
  details text not null default '',
  quantity int not null default 1,
  estimated_cents int,
  needed_by timestamptz,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  status text not null default 'NEW' check (status in ('NEW','PENDING_APPROVAL','APPROVED','DENIED','ASSIGNED','IN_PROGRESS','ON_HOLD','ORDERED','COMPLETED','CANCELLED')),
  assigned_team_id text references ops.teams(id) on delete set null,
  assignee_id text references ops.users(id) on delete set null on update cascade,
  approver_team_id text,
  approver_id text references ops.users(id) on update cascade,
  decision_note text,
  decided_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on ops.requests (requester_id);
create index on ops.requests (status);
create index on ops.requests (campus_id, status);
create index on ops.requests (assigned_team_id, status);

create table ops.request_lines (
  id text primary key default ops.id(),
  request_id text not null references ops.requests(id) on delete cascade,
  supply_item_id text references ops.supply_items(id) on delete set null,
  description text not null, quantity int not null, unit text
);
create table ops.request_comments (
  id text primary key default ops.id(),
  request_id text not null references ops.requests(id) on delete cascade,
  author_id text not null references ops.users(id) on update cascade,
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create table ops.request_events (
  id text primary key default ops.id(),
  request_id text not null references ops.requests(id) on delete cascade,
  action text not null,
  from_status text, to_status text,
  actor_id text references ops.users(id) on update cascade,
  note text,
  created_at timestamptz not null default now()
);
create index on ops.request_events (request_id, created_at);

-- ── Accountability log ───────────────────────────────────────────
create table ops.activity_log (
  id text primary key default ops.id(),
  actor_id text references ops.users(id) on delete set null on update cascade,
  actor_label text,
  action text not null,
  detail text,
  area text not null,               -- AUTH | AVL | REQUESTS | ADMIN | SYNC
  entity_type text, entity_id text, href text, campus_id text,
  created_at timestamptz not null default now()
);
create index on ops.activity_log (created_at);
create index on ops.activity_log (area, created_at);

-- RLS on everywhere, no policies: only the ops Edge Function (database connection) gets in.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'ops' loop
    execute format('alter table ops.%I enable row level security', t.tablename);
    execute format('revoke all on ops.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;

-- ── Registering (Supabase Auth) ──────────────────────────────────
-- A new sign-up becomes a person waiting for approval. The very first one runs the place
-- (System admin, all campuses). Someone a manager already added takes over that row (approved).
create or replace function ops.on_auth_user() returns trigger language plpgsql security definer set search_path = ops, public as $$
declare
  em text := lower(new.email);
  nm text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(em, '@', 1));
  existing ops.users;
begin
  if em is null then return new; end if;
  select * into existing from ops.users where email = em;
  if found then
    update ops.users set id = new.id::text, registered = true, updated_at = now() where email = em;
  elsif not exists (select 1 from ops.users where registered) then
    insert into ops.users (id, email, name, active, pending, registered, role, all_campuses, approved_at)
      values (new.id::text, em, nm, true, false, true, 'ADMIN', true, now());
  else
    insert into ops.users (id, email, name, active, pending, registered) values (new.id::text, em, nm, false, true, true);
  end if;
  return new;
end $$;
revoke all on function ops.on_auth_user() from public, anon, authenticated;
drop trigger if exists ops_on_auth_user on auth.users;
create trigger ops_on_auth_user after insert on auth.users for each row execute function ops.on_auth_user();

-- ── Request types to start from (edit or remove them under Settings → Request types) ──
insert into ops.request_categories (name, icon, kind, workflow, description, approval_threshold_cents, requires_location, allow_line_items, sort_order) values
  ('Laptop', '💻', 'TECHNOLOGY', 'APPROVAL', 'New or replacement laptop', null, false, false, 0),
  ('iPad / Tablet', '📱', 'TECHNOLOGY', 'APPROVAL', 'iPads for ministry, check-in, or production', null, false, false, 1),
  ('Software & licenses', '🧩', 'TECHNOLOGY', 'APPROVAL', 'Apps, subscriptions, seats', null, false, false, 2),
  ('Tech accessories', '🖱️', 'TECHNOLOGY', 'FULFILLMENT', 'Chargers, cables, keyboards, cases', 10000, false, false, 3),
  ('Tech support', '🛠️', 'TECHNOLOGY', 'WORK_ORDER', 'Something broken or not working', null, false, false, 4),
  ('Restroom supplies', '🧻', 'SUPPLY', 'FULFILLMENT', 'Paper towels, toilet paper, soap', 25000, true, true, 5),
  ('Janitorial & cleaning', '🧽', 'SUPPLY', 'FULFILLMENT', 'Cleaners, wipes, trash bags', 25000, false, true, 6),
  ('Kitchen & breakroom', '☕', 'SUPPLY', 'FULFILLMENT', 'Coffee, cups, plates, utensils', 25000, false, true, 7),
  ('Office supplies', '📎', 'SUPPLY', 'FULFILLMENT', 'Paper, pens, toner', 25000, false, true, 8),
  ('Plumbing', '🚰', 'MAINTENANCE', 'WORK_ORDER', 'Leaks, clogs, toilets, sinks, water fountains', null, true, false, 9),
  ('Electrical & lighting', '💡', 'MAINTENANCE', 'WORK_ORDER', 'Outlets, breakers, bulbs, fixtures', null, true, false, 10),
  ('HVAC / temperature', '❄️', 'MAINTENANCE', 'WORK_ORDER', 'Too hot, too cold, noisy units', null, true, false, 11),
  ('Ceilings & walls', '🧱', 'MAINTENANCE', 'WORK_ORDER', 'Ceiling tiles, stains, drywall, paint', null, true, false, 12),
  ('Doors, locks & keys', '🔑', 'MAINTENANCE', 'WORK_ORDER', 'Door hardware, re-keying, access', null, true, false, 13),
  ('Furniture & room setup', '🪑', 'MAINTENANCE', 'WORK_ORDER', 'Broken furniture, event setup', null, true, false, 14),
  ('General repair', '🔧', 'MAINTENANCE', 'WORK_ORDER', 'Anything else in the building', null, true, false, 15),
  ('Grounds & parking', '🌳', 'MAINTENANCE', 'WORK_ORDER', 'Landscaping, lot lights, signage', null, true, false, 16);

insert into ops.supply_items (category_id, name, unit, unit_cost_cents, sort_order)
select c.id, v.name, v.unit, v.cost, v.ord from ops.request_categories c join (values
  ('Restroom supplies', 'Paper towels (multifold)', 'case', 4200, 0), ('Restroom supplies', 'Toilet paper (jumbo roll)', 'case', 5500, 1),
  ('Restroom supplies', 'Hand soap refill', 'case', 3800, 2), ('Restroom supplies', 'Seat covers', 'box', 2400, 3), ('Restroom supplies', 'Trash liners (small)', 'case', 2100, 4),
  ('Janitorial & cleaning', 'Disinfectant wipes', 'case', 4800, 0), ('Janitorial & cleaning', 'Multi-surface cleaner', 'case', 3200, 1),
  ('Janitorial & cleaning', 'Glass cleaner', 'case', 2900, 2), ('Janitorial & cleaning', 'Trash bags (55 gal)', 'case', 3600, 3), ('Janitorial & cleaning', 'Mop heads', 'each', 900, 4),
  ('Kitchen & breakroom', 'Coffee (ground, 2 lb)', 'bag', 1800, 0), ('Kitchen & breakroom', 'Hot cups (12 oz)', 'case', 4500, 1), ('Kitchen & breakroom', 'Creamer', 'case', 2200, 2),
  ('Kitchen & breakroom', 'Paper plates', 'case', 3400, 3), ('Kitchen & breakroom', 'Napkins', 'case', 2600, 4), ('Kitchen & breakroom', 'Plastic utensils', 'box', 1500, 5),
  ('Office supplies', 'Copy paper (letter)', 'case', 4900, 0), ('Office supplies', 'Pens (black)', 'box', 800, 1), ('Office supplies', 'Sticky notes', 'pack', 700, 2), ('Office supplies', 'Packing tape', 'roll', 400, 3)
) as v(cat, name, unit, cost, ord) on v.cat = c.name;
