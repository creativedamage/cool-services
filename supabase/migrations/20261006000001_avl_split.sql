-- Sundays | Operations and AVL become two apps on one sign-in.
--  · ops_access: whether someone uses Operations (church business). AVL access stays avl_level.
--  · AVL's clients (other churches) get contacts, a website and an active flag.
--  · AVL's own business profile and quote defaults (the letterhead on proposals), separate from the church.

alter table ops.users add column if not exists ops_access boolean not null default true;

alter table ops.customers add column if not exists website text;
alter table ops.customers add column if not exists active boolean not null default true;

create table if not exists ops.customer_contacts (
  id text primary key default ops.id(),
  customer_id text not null references ops.customers(id) on delete cascade,
  name text not null,
  title text, email text, phone text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists customer_contacts_customer_idx on ops.customer_contacts (customer_id);
alter table ops.customer_contacts enable row level security;

create table if not exists ops.avl_business (
  id text primary key default 'avl' check (id = 'avl'),
  name text, legal_name text, address_line1 text, address_line2 text, city text, state text, postal_code text,
  phone text, email text, website text, ein text, sales_tax_id text,
  default_tax_bps int not null default 700,
  default_deposit_bps int not null default 5000,
  default_margin_bps int not null default 3000,
  labor_rate_cents int not null default 8500,
  quote_valid_days int not null default 30,
  quote_terms text,
  quote_prefix text not null default 'AV',
  updated_at timestamptz not null default now()
);
alter table ops.avl_business enable row level security;

-- Start AVL from what the church had set up (same letterhead and quote defaults until changed).
insert into ops.avl_business (id, name, legal_name, address_line1, address_line2, city, state, postal_code, phone, email, website, ein, sales_tax_id,
  default_tax_bps, default_deposit_bps, default_margin_bps, labor_rate_cents, quote_valid_days, quote_terms, quote_prefix)
select 'avl', name, legal_name, address_line1, address_line2, city, state, postal_code, phone, email, website, ein, sales_tax_id,
  case when tax_exempt then 0 else default_tax_bps end, default_deposit_bps, default_margin_bps, labor_rate_cents, quote_valid_days, quote_terms, quote_prefix
from ops.organization where id = 'org'
on conflict (id) do nothing;

-- Existing clients' contact becomes their primary contact.
insert into ops.customer_contacts (customer_id, name, email, phone, is_primary)
select c.id, c.contact_name, c.email, c.phone, true from ops.customers c
where c.contact_name is not null and not exists (select 1 from ops.customer_contacts x where x.customer_id = c.id);

-- AVL links in the activity log moved from /ops to /avl.
update ops.activity_log set href = regexp_replace(href, '^/ops/(quotes|vendors|catalog)', '/avl/\1') where href ~ '^/ops/(quotes|vendors|catalog)';
