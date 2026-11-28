-- Procurement and budgets (E46, wave 26): solicitations with their offers, evaluation and award, purchase
-- orders with lines and receiving, and operating and capital budgets with their lines. Other modules'
-- records (vendors, contracts, funding awards, departments, projects, assets, documents) are named by id:
-- no foreign keys across modules.

-- A procurement (solicitation): how it is bought, for how much, by whom, on what schedule, and its award.
create table procurements (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  method text,                        -- procurement_method (micro-purchase, sealed bid, ...)
  solicitation_type text,             -- solicitation_type (request for proposals, quotes, information, bids)
  status text,                        -- procurement_status
  estimated_value numeric(14,2),
  independent_estimate numeric(14,2), -- independent cost estimate, made before offers are opened
  independent_estimate_on date,
  funding_award_id uuid,              -- funding module
  department_id uuid,                 -- the requesting department
  buyer_id uuid,
  document_id uuid,                   -- the solicitation document in the document library (policies module)
  issued_on date,
  questions_due_on date,
  proposals_due_at timestamptz,
  award_planned_on date,
  justification text,                 -- sole-source or emergency justification
  awarded_offer_id uuid,
  awarded_on date,
  awarded_by uuid,
  awarded_by_name text,
  award_amount numeric(14,2),
  award_reason text,
  contract_id uuid,                   -- vendors module: the resulting contract
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index procurements_status_ix on procurements (status) where deleted_at is null;
create index procurements_due_ix on procurements (proposals_due_at) where deleted_at is null;

-- An offer received (a bid, proposal or quote), from a vendor record or a plain name.
create table procurement_offers (
  id uuid primary key default gen_random_uuid(),
  ref text,
  procurement_id uuid not null,
  vendor_id uuid,
  bidder_name text,
  received_at timestamptz,
  amount numeric(14,2),
  status text,                        -- offer_status
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index procurement_offers_procurement_ix on procurement_offers (procurement_id) where deleted_at is null;

-- Evaluation criteria with their weights.
create table procurement_criteria (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references procurements(id) on delete cascade,
  name text not null,
  description text,
  weight numeric(7,2) not null,
  max_score numeric(7,2) not null default 10,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid
);
create index procurement_criteria_procurement_ix on procurement_criteria (procurement_id);

-- The evaluation committee: each member's conflict-of-interest declaration and whether their scores are in.
create table procurement_evaluators (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references procurements(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',  -- evaluator_role
  coi_status text not null default 'pending',  -- pending | none | conflict
  coi_note text,
  coi_declared_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  unique (procurement_id, user_id)
);

-- One evaluator's score of one offer against one criterion.
create table procurement_scores (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references procurements(id) on delete cascade,
  offer_id uuid not null references procurement_offers(id) on delete cascade,
  criterion_id uuid not null references procurement_criteria(id) on delete cascade,
  evaluator_id uuid not null,         -- the evaluator's account
  score numeric(7,2) not null,
  comment text,
  scored_at timestamptz not null default now(),
  recorded_by uuid,                   -- the real actor (an administrator in a data load)
  unique (offer_id, criterion_id, evaluator_id)
);
create index procurement_scores_procurement_ix on procurement_scores (procurement_id);

-- Addenda issued to a solicitation.
create table procurement_addenda (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references procurements(id) on delete cascade,
  number int not null,
  issued_on date not null,
  summary text not null,
  document_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  unique (procurement_id, number)
);

-- Protests log.
create table procurement_protests (
  id uuid primary key default gen_random_uuid(),
  procurement_id uuid not null references procurements(id) on delete cascade,
  protester text not null,
  vendor_id uuid,
  received_on date not null,
  grounds text,
  status text not null default 'received',  -- protest_status
  decided_on date,
  decision text,
  decided_by uuid,
  decided_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now()
);

-- Budgets: one per fiscal year (or one operating and one capital budget per year).
create table budgets (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  fiscal_year text not null,
  starts_on date,
  ends_on date,
  status text,                        -- budget_status
  owner_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  ref text,
  budget_id uuid not null,
  title text not null,
  kind text,                          -- budget_kind: operating | capital
  department_id uuid,
  account text,
  amount numeric(14,2) not null default 0,
  project_id uuid,                    -- projects module (capital lines)
  funding_award_id uuid,              -- funding module
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index budget_lines_budget_ix on budget_lines (budget_id) where deleted_at is null;

-- Purchase orders, their lines and what was received.
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  vendor_id uuid,
  vendor_name text,
  order_date date,
  status text,                        -- po_status, managed by the application
  total numeric(14,2) not null default 0,
  department_id uuid,
  requested_by uuid,
  procurement_id uuid,
  contract_id uuid,
  budget_line_id uuid,
  needed_by date,
  submitted_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  issued_on date,
  received_on date,
  closed_on date,
  canceled_reason text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index purchase_orders_status_ix on purchase_orders (status) where deleted_at is null;

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null,
  line_no int not null default 1,
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  budget_line_id uuid,
  asset_id uuid,                      -- inventory module
  received_quantity numeric(14,3) not null default 0,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index purchase_order_lines_po_ix on purchase_order_lines (purchase_order_id) where deleted_at is null;
create index purchase_order_lines_budget_ix on purchase_order_lines (budget_line_id) where deleted_at is null;

create table purchase_order_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null,
  line_id uuid not null references purchase_order_lines(id) on delete cascade,
  quantity numeric(14,3) not null,
  received_on date not null,
  received_by uuid,
  received_by_name text,
  note text,
  created_at timestamptz not null default now(), created_by uuid
);
create index purchase_order_receipts_po_ix on purchase_order_receipts (purchase_order_id);
