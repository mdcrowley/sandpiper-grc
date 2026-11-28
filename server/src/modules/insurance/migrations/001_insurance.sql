-- Insurance (wave 26): the organization's insurance program. Policies with their limits, deductibles,
-- conditions and covered records; certificates of insurance received from vendors and contractors,
-- checked against the minimum insurance each contract requires; claims with reserves, payments and
-- recoveries. Other modules' records (vendors, contracts, controls, assets, vehicles, sites, systems,
-- safety events, security incidents) are named by id: no foreign keys across modules.

create table insurance_policies (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  line text,                          -- insurance_line
  insurer_kind text,                  -- insurer_kind: insurer | risk_pool | self
  insurer_id uuid,                    -- a vendor (vendors module), when the carrier or pool is one
  insurer_name text,                  -- the carrier or pool by name, when it is not a vendor
  broker_name text,
  policy_number text,
  status text,                        -- insurance_policy_status
  effective_on date,
  expires_on date,
  premium numeric(14,2),
  limit_per_occurrence numeric(16,2),
  limit_aggregate numeric(16,2),
  deductible numeric(14,2),
  retention numeric(14,2),            -- self-insured retention
  sublimits text,
  named_insureds text,
  owner_id uuid,
  department_id uuid,
  renewal_status text,                -- insurance_renewal_status
  renewal_application_due date,
  replaces_id uuid references insurance_policies(id) on delete set null,   -- the policy of the term before
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_policies_expires_ix on insurance_policies (expires_on) where deleted_at is null;
create index insurance_policies_department_ix on insurance_policies (department_id);

-- What a policy must keep meeting (warranties, conditions, security requirements of a cyber policy),
-- each optionally tracked by a control of the control library.
create table insurance_conditions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references insurance_policies(id) on delete cascade,
  title text not null,
  description text,
  control_id uuid,                    -- controls module
  status text,                        -- insurance_condition_status
  due_on date,
  owner_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_conditions_policy_ix on insurance_conditions (policy_id) where deleted_at is null;

-- Records a policy covers: assets, vehicles, sites and systems.
create table insurance_covered (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references insurance_policies(id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  unique (policy_id, record_type, record_id)
);
create index insurance_covered_record_ix on insurance_covered (record_type, record_id);

-- The insurance a contract requires of the vendor: one line of coverage with its minimum limits.
create table insurance_requirements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  contract_id uuid not null,          -- vendors module
  line text not null,                 -- insurance_line
  min_per_occurrence numeric(16,2),
  min_aggregate numeric(16,2),
  additional_insured boolean not null default false,
  waiver_of_subrogation boolean not null default false,
  state text,                         -- insurance_requirement_state, worked out from the certificates
  state_notes text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_requirements_contract_ix on insurance_requirements (contract_id) where deleted_at is null;

-- Certificates of insurance received from vendors and contractors.
create table insurance_certificates (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  vendor_id uuid,
  contract_id uuid,
  insured_name text,
  line text,                          -- insurance_line
  insurer_name text,
  policy_number text,
  effective_on date,
  expires_on date,
  limit_per_occurrence numeric(16,2),
  limit_aggregate numeric(16,2),
  additional_insured boolean not null default false,
  waiver_of_subrogation boolean not null default false,
  received_on date,
  status text,                        -- insurance_certificate_status
  check_result text,                  -- insurance_certificate_check, worked out against the contract
  check_notes text,
  owner_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_certificates_expires_ix on insurance_certificates (expires_on) where deleted_at is null;
create index insurance_certificates_vendor_ix on insurance_certificates (vendor_id) where deleted_at is null;
create index insurance_certificates_contract_ix on insurance_certificates (contract_id) where deleted_at is null;

-- Claims made under the organization's policies, or against it.
create table insurance_claims (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  policy_id uuid references insurance_policies(id) on delete set null,
  claim_kind text,                    -- insurance_claim_kind
  direction text,                     -- insurance_claim_direction
  status text,                        -- insurance_claim_status
  incident_on date,
  reported_on date,
  claimant_name text,
  carrier_claim_number text,
  adjuster_name text,
  description text,
  safety_event_id uuid,               -- safety module
  security_incident_id uuid,          -- secincidents module
  asset_id uuid,
  vehicle_id uuid,
  site_id uuid,
  reserve numeric(16,2),
  paid numeric(16,2),
  recovered numeric(16,2),
  closed_on date,
  owner_id uuid,
  restricted boolean not null default false,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index insurance_claims_policy_ix on insurance_claims (policy_id) where deleted_at is null;
create index insurance_claims_status_ix on insurance_claims (status) where deleted_at is null;
