-- Sundays AVL, phase 5: purchasing and job costing.
--
-- · Purchase orders: to a vendor, for a job (or stock). Lines point at the job's budget items so
--   the budget knows what's committed. Every PO is approved by an AVL Manager before it goes out;
--   it's then emailed to the vendor (with a link to a printable copy) or marked ordered.
-- · Receiving: what arrived, line by line, partial or full (po_receipts keeps the history).
-- · Work orders: scope and cost for a subcontractor or installer, against the job's budget items.
-- · Vendor bills: what a vendor actually charged, against a PO, a work order or straight to the job.
-- · Change orders: lines added to (or credited from) a job after the sale. The client signs online
--   like a proposal; once approved, each line joins the job's budget.
--
-- Committed cost = approved POs and sent work orders. Actual cost = bills and logged time. Both are
-- sums over the lines that point at a budget item, never typed.

-- ── Purchase orders (the table has been here since 1.0 with no screens; nothing is in it) ──
alter table ops.purchase_orders add column if not exists job_id text references ops.jobs(id) on delete set null;
alter table ops.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table ops.purchase_orders add constraint purchase_orders_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED'));
alter table ops.purchase_orders add column if not exists submitted_at timestamptz;
alter table ops.purchase_orders add column if not exists approved_at timestamptz;
alter table ops.purchase_orders add column if not exists approved_by_id text references ops.users(id) on delete set null on update cascade;
alter table ops.purchase_orders add column if not exists rejected_note text;
alter table ops.purchase_orders add column if not exists sent_at timestamptz;
alter table ops.purchase_orders add column if not exists sent_to text;
alter table ops.purchase_orders add column if not exists expected_date date;
alter table ops.purchase_orders add column if not exists ship_to text;
alter table ops.purchase_orders add column if not exists notes text;
alter table ops.purchase_orders add column if not exists shipping_cents bigint not null default 0 check (shipping_cents >= 0);
alter table ops.purchase_orders add column if not exists tax_cents bigint not null default 0 check (tax_cents >= 0);
alter table ops.purchase_orders add column if not exists public_token text unique;
alter table ops.purchase_orders add column if not exists cancelled_at timestamptz;
alter table ops.purchase_orders add column if not exists updated_at timestamptz not null default now();
create index if not exists purchase_orders_job on ops.purchase_orders (job_id);
create index if not exists purchase_orders_status on ops.purchase_orders (org_id, status);

alter table ops.purchase_order_items add column if not exists budget_item_id text references ops.budget_items(id) on delete set null;
alter table ops.purchase_order_items add column if not exists product_id text references ops.products(id) on delete set null;
alter table ops.purchase_order_items add column if not exists description text;
alter table ops.purchase_order_items add column if not exists unit text;
alter table ops.purchase_order_items add column if not exists sort_order int not null default 0;
alter table ops.purchase_order_items drop constraint if exists purchase_order_items_qty_check;
alter table ops.purchase_order_items add constraint purchase_order_items_qty_check check (quantity > 0 and received_qty >= 0 and received_qty <= quantity and unit_cost_cents >= 0);
create index if not exists purchase_order_items_po on ops.purchase_order_items (po_id, sort_order);
create index if not exists purchase_order_items_budget on ops.purchase_order_items (budget_item_id);

create table if not exists ops.po_receipts (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  po_id text not null references ops.purchase_orders(id) on delete cascade,
  received_by_id text references ops.users(id) on delete set null on update cascade,
  received_at timestamptz not null default now(),
  note text,
  -- [{ "itemId": "…", "name": "…", "qty": 2 }]
  lines jsonb not null default '[]'
);
create index if not exists po_receipts_po on ops.po_receipts (po_id, received_at);

-- ── Work orders ──
create table if not exists ops.work_orders (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  number text not null,
  title text not null,
  vendor_id text references ops.vendors(id) on delete set null,
  -- An installer who isn't a vendor in Sundays.
  assignee_name text,
  assignee_email text,
  scope text,
  start_date date,
  due_date date,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'DONE', 'CANCELLED')),
  public_token text unique,
  sent_at timestamptz,
  sent_to text,
  accepted_at timestamptz,
  accepted_by text,
  done_at timestamptz,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists work_orders_org_number on ops.work_orders (org_id, number);
create index if not exists work_orders_job on ops.work_orders (job_id);

create table if not exists ops.work_order_items (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  work_order_id text not null references ops.work_orders(id) on delete cascade,
  budget_item_id text references ops.budget_items(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null default 1 check (quantity > 0),
  unit text,
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  sort_order int not null default 0
);
create index if not exists work_order_items_wo on ops.work_order_items (work_order_id, sort_order);
create index if not exists work_order_items_budget on ops.work_order_items (budget_item_id);

-- ── Vendor bills ──
create table if not exists ops.vendor_bills (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text references ops.jobs(id) on delete set null,
  vendor_id text references ops.vendors(id) on delete set null,
  po_id text references ops.purchase_orders(id) on delete set null,
  work_order_id text references ops.work_orders(id) on delete set null,
  -- The vendor's own invoice number.
  bill_number text,
  bill_date date not null default current_date,
  due_date date,
  status text not null default 'OPEN' check (status in ('OPEN', 'PAID', 'VOID')),
  paid_at timestamptz,
  -- Shipping, freight, tax and the like that aren't on a budget line.
  other_cents bigint not null default 0,
  notes text,
  -- A scan or PDF of the bill (in the job's files).
  file_id text references ops.job_files(id) on delete set null,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendor_bills_job on ops.vendor_bills (job_id);
create index if not exists vendor_bills_po on ops.vendor_bills (po_id);
create index if not exists vendor_bills_status on ops.vendor_bills (org_id, status, due_date);

create table if not exists ops.vendor_bill_lines (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  bill_id text not null references ops.vendor_bills(id) on delete cascade,
  budget_item_id text references ops.budget_items(id) on delete set null,
  po_item_id text references ops.purchase_order_items(id) on delete set null,
  work_order_item_id text references ops.work_order_items(id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null default 1,
  unit_cost_cents bigint not null default 0,
  sort_order int not null default 0
);
create index if not exists vendor_bill_lines_bill on ops.vendor_bill_lines (bill_id, sort_order);
create index if not exists vendor_bill_lines_budget on ops.vendor_bill_lines (budget_item_id);
create index if not exists vendor_bill_lines_po_item on ops.vendor_bill_lines (po_item_id);

-- ── Change orders ──
create table if not exists ops.change_orders (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  number text not null,
  title text not null,
  description text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'CANCELLED')),
  tax_bps int not null default 0 check (tax_bps between 0 and 5000),
  public_token text unique,
  sent_at timestamptz,
  sent_total_cents bigint,
  approved_at timestamptz,
  -- How it was approved when the client didn't sign online.
  approved_note text,
  declined_at timestamptz,
  decline_note text,
  signer_name text,
  signer_email text,
  signer_title text,
  signature_image text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  signed_total_cents bigint,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists change_orders_org_number on ops.change_orders (org_id, number);
create index if not exists change_orders_job on ops.change_orders (job_id);

create table if not exists ops.change_order_items (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  change_order_id text not null references ops.change_orders(id) on delete cascade,
  -- The cost group it joins (made if the job doesn't have it yet).
  group_name text not null default 'Changes',
  name text not null,
  description text,
  cost_type text not null default 'MATERIAL' check (cost_type in ('MATERIAL', 'LABOR', 'SUBCONTRACT', 'OTHER')),
  -- Negative for a credit (something taken out).
  quantity numeric(14, 3) not null default 1 check (quantity <> 0),
  unit text,
  unit_cost_cents bigint not null default 0,
  unit_price_cents bigint not null default 0,
  taxable boolean not null default true,
  product_id text references ops.products(id) on delete set null,
  -- Set once approved: the budget item this line became.
  budget_item_id text references ops.budget_items(id) on delete set null,
  sort_order int not null default 0
);
create index if not exists change_order_items_co on ops.change_order_items (change_order_id, sort_order);

-- ── Budget items: where they came from, and "all costs are in" ──
alter table ops.budget_items add column if not exists change_order_id text references ops.change_orders(id) on delete set null;
alter table ops.budget_items add column if not exists final boolean not null default false;

do $$ declare t text; begin
  foreach t in array array['po_receipts', 'work_orders', 'work_order_items', 'vendor_bills', 'vendor_bill_lines', 'change_orders', 'change_order_items'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;
