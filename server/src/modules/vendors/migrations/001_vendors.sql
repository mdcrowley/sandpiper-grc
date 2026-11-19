create table vendors (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  services text,
  criticality text,
  remote_access_method text,
  incident_contact_name text,
  incident_contact_email text,
  incident_contact_phone text,
  notes text,
  status text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendors_name_ix on vendors (lower(name));

create table vendor_contacts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  name text not null,
  role text,
  email text,
  phone text,
  is_incident_contact boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_contacts_vendor_ix on vendor_contacts (vendor_id);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  ref text,
  vendor_id uuid not null,
  title text not null,
  document_type text,
  parties text,
  start_date date,
  end_date date,
  term text,
  renewal_mechanism text,
  notice_days int,
  notice_date date,                 -- computed on save: end_date minus notice_days
  value_by_year jsonb,
  total_value numeric,
  resolution_number text,
  owner_id uuid,
  status text,
  notes text,
  -- free text kept exactly as it stands in the contract register
  document_on_file text,
  date_and_resolution text,
  term_and_renewal text,
  value_text text,
  hosting text,
  terms_not_on_file text,
  import_key text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index contracts_vendor_ix on contracts (vendor_id);
create index contracts_notice_ix on contracts (notice_date);

create table contract_clause_checks (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  clause_key text not null,
  status text,                      -- present | absent | partial; null = not assessed
  clause_text text,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (contract_id, clause_key)
);

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null,
  contract_id uuid,
  type text,
  title text not null,
  received_on date,
  expires_on date,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index evidence_items_vendor_ix on evidence_items (vendor_id);
create index evidence_items_expires_ix on evidence_items (expires_on);

create table contract_reminders (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  threshold_days int not null,
  due_on date not null,
  fired_at timestamptz,
  superseded boolean not null default false,   -- a nearer reminder fired in the same run, so this one stayed quiet
  created_at timestamptz not null default now(),
  unique (contract_id, threshold_days)
);
