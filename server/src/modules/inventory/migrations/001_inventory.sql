-- Inventory: systems, assets, sites, data categories and the relationships between them.
-- References to vendors, contracts and users are plain uuid columns (no cross-module keys).

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  function text,
  technology text,
  power_protection text,
  physical_security text,
  protection_notes text,
  third_parties text,
  network_links text,
  to_confirm text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index sites_name_ix on sites (lower(name));

create table data_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contains text,
  where_held text,
  custodian text,
  shared_with text,
  governing_rule text,
  retention_period text,
  sensitivity_level text,
  gaps text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index data_categories_name_ix on data_categories (lower(name));

create table systems (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  system_group text,
  vendor_name text,
  vendor_id uuid,
  function text,
  business_owner_id uuid,
  technical_owner_id uuid,
  users text,
  hosting_type text,
  hosting_provider text,
  hosting_region text,
  hosting_notes text,
  criticality_tier text,
  rto_hours numeric,
  rpo_hours numeric,
  manual_fallback text,
  authentication_method text,
  mfa_status text,
  status text,
  planned_replacement text,
  contract_id uuid,
  status_outlook text,
  sensitive_data_held text,
  agreement_on_file text,
  source text,
  to_confirm text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index systems_name_ix on systems (lower(name));
create index systems_vendor_ix on systems (vendor_id);

create table assets (
  id uuid primary key default gen_random_uuid(),
  tag text,
  name text not null,
  asset_type text,
  make text,
  model text,
  serial text,
  status text,
  owner_id uuid,
  user_id uuid,
  assigned_to_name text,
  department text,
  site_id uuid,
  location text,
  purchase_date date,
  cost numeric,
  funding_source text,
  funder_interest boolean not null default false,
  funder_interest_pct numeric,
  warranty_end date,
  support_end date,
  os text,
  os_version text,
  ip_address text,
  mac_address text,
  vendor_id uuid,
  contract_id uuid,
  system_id uuid,
  disposal_approved_by text,
  disposal_approved_on date,
  disposal_approval_ref text,
  disposal_method text,
  disposed_on date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index assets_tag_ix on assets (lower(tag));
create index assets_serial_ix on assets (lower(serial));
create index assets_site_ix on assets (site_id);
create index assets_system_ix on assets (system_id);
create index assets_status_ix on assets (status);

create table asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id),
  user_id uuid,
  assignee_name text,
  department text,
  site_id uuid,
  location text,
  due_back_on date,
  notes text,
  checked_out_at timestamptz not null default now(),
  checked_out_by uuid,
  checked_in_at timestamptz,
  checked_in_by uuid,
  check_in_notes text
);
create index asset_assignments_asset_ix on asset_assignments (asset_id, checked_out_at desc);

create table system_integrations (
  id uuid primary key default gen_random_uuid(),
  from_system_id uuid not null references systems(id),
  to_system_id uuid not null references systems(id),
  direction text not null default 'one_way',
  method text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  check (from_system_id <> to_system_id)
);
create index system_integrations_from_ix on system_integrations (from_system_id);
create index system_integrations_to_ix on system_integrations (to_system_id);

create table system_data_categories (
  system_id uuid not null references systems(id),
  data_category_id uuid not null references data_categories(id),
  created_at timestamptz not null default now(), created_by uuid,
  primary key (system_id, data_category_id)
);

create table system_sites (
  system_id uuid not null references systems(id),
  site_id uuid not null references sites(id),
  created_at timestamptz not null default now(), created_by uuid,
  primary key (system_id, site_id)
);
