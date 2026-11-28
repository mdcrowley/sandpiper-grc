-- Insurance, wave 27: claim payments one by one (E46-62), premium allocation (E46-64), the property
-- schedule of values (E46-64) and requests to vendors for certificates of insurance (E46-65).
-- Other modules' records are named by id: no foreign keys across modules.

-- Each payment on a claim and each recovery, one row each. The claim's paid and recovered totals are
-- worked out from them. The row follows its claim's restriction (source_type + claim_id).
create table insurance_claim_payments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references insurance_claims(id),
  source_type text not null default 'insurance_claim',
  title text not null,
  paid_on date not null,
  kind text not null,                 -- insurance_payment_kind (meta.recovery: money coming in)
  payee text,                         -- who was paid, or who paid the organization
  amount numeric(16,2) not null,
  reference text,                     -- check, transfer or remittance number
  note text,
  recorded_by uuid,
  recorded_by_name text,
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_claim_payments_claim_ix on insurance_claim_payments (claim_id) where deleted_at is null;

-- The totals kept before payments were listed become one opening row each, so the totals still add up.
insert into insurance_claim_payments (claim_id, title, paid_on, kind, amount, note, restricted, created_at, created_by)
select id, 'Paid before payments were listed', coalesce(reported_on, incident_on, created_at::date), 'opening_paid', paid,
       'The total paid recorded on the claim before payments were listed one by one.', restricted, created_at, created_by
from insurance_claims where deleted_at is null and coalesce(paid, 0) > 0;
insert into insurance_claim_payments (claim_id, title, paid_on, kind, amount, note, restricted, created_at, created_by)
select id, 'Recovered before payments were listed', coalesce(closed_on, reported_on, incident_on, created_at::date), 'opening_recovery', recovered,
       'The total recovered recorded on the claim before payments were listed one by one.', restricted, created_at, created_by
from insurance_claims where deleted_at is null and coalesce(recovered, 0) > 0;

-- How a policy's premium is split: insurance_allocation_method (equal, measure, insured_value, manual),
-- and what the measure counts when it is split by a measure ("Vehicles", "Payroll", "Square feet").
alter table insurance_policies add column if not exists allocation_method text;
alter table insurance_policies add column if not exists allocation_measure text;

-- One share of a policy's premium: a department, site, asset or vehicle with its percentage (by hand)
-- or its measure, and the share and amount worked out.
create table insurance_premium_shares (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references insurance_policies(id),
  title text not null,
  department_id uuid,
  site_id uuid,
  asset_id uuid,
  vehicle_id uuid,
  percent numeric(9,4),               -- by hand
  measure numeric(18,4),              -- by a measure
  weight numeric(20,4),               -- what the share was worked out from
  share_pct numeric(9,4),             -- worked out
  amount numeric(16,2),               -- worked out
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_premium_shares_policy_ix on insurance_premium_shares (policy_id) where deleted_at is null;

-- The property schedule of values: each covered building, contents, equipment or vehicle with its values.
create table insurance_schedule_items (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  policy_id uuid references insurance_policies(id) on delete set null,
  site_id uuid,
  asset_id uuid,
  vehicle_id uuid,
  department_id uuid,
  location text,
  occupancy text,
  construction text,
  year_built int,
  floor_area numeric(14,2),
  building_value numeric(16,2),
  contents_value numeric(16,2),
  equipment_value numeric(16,2),
  income_value numeric(16,2),
  total_value numeric(16,2),          -- worked out: the sum of the values
  valuation_basis text,               -- insurance_valuation_basis
  valued_on date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_schedule_items_policy_ix on insurance_schedule_items (policy_id) where deleted_at is null;

-- A request to a vendor for its certificates of insurance: emailed with a personal upload link. Only a
-- hash of the link's secret is kept for checking it, and the secret itself sealed with the
-- installation's key so a reminder can carry the same link.
create table insurance_certificate_requests (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  vendor_id uuid,
  contract_id uuid,
  lines jsonb not null default '[]',  -- insurance_line values asked for
  email text,
  recipient_name text,
  message text,
  needed_by date,
  status text,                        -- insurance_request_status
  owner_id uuid,
  token_hash text unique,
  token_sealed text,
  link_expires_at timestamptz,
  sent_at timestamptz,
  sent_by uuid,
  opened_at timestamptz,
  reminded_at timestamptz,
  reminders int not null default 0,
  reminded_steps jsonb not null default '[]',
  submitted_at timestamptz,
  responder_name text,
  certificates int not null default 0,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_certificate_requests_vendor_ix on insurance_certificate_requests (vendor_id) where deleted_at is null;
create index insurance_certificate_requests_contract_ix on insurance_certificate_requests (contract_id) where deleted_at is null;

-- A certificate the vendor sent through a request names the request.
alter table insurance_certificates add column if not exists request_id uuid references insurance_certificate_requests(id) on delete set null;
create index insurance_certificates_request_ix on insurance_certificates (request_id) where deleted_at is null;
