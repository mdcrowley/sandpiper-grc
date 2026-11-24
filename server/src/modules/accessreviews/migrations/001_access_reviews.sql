-- User access reviews (E41-02): the register of accounts on each system, and review campaigns that
-- ask each system's owner to keep or remove every account. Systems, people, users, controls, control
-- tests and actions belong to other modules: plain uuid columns, no foreign keys across modules.

create table system_accounts (
  id uuid primary key default gen_random_uuid(),
  ref text,
  system_id uuid not null,
  -- The account as the system knows it (a login or user id), unique per system.
  account_name text not null,
  display_name text,
  email text,
  employee_number text,
  -- The staff roster person holding the account (people module), matched or chosen.
  holder_person_id uuid,
  match_method text,
  account_kind text not null default 'person',
  role_on_system text,
  privileged boolean not null default false,
  status text not null default 'active',
  last_seen_on date,
  -- Worked out by the application: leaver, on_leave or unmatched for an active personal account.
  attention text,
  source text not null default 'manual',
  last_imported_at timestamptz,
  removal_requested_on date,
  removed_on date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index system_accounts_name_ux on system_accounts (system_id, lower(account_name)) where deleted_at is null;
create index system_accounts_holder_ix on system_accounts (holder_person_id) where deleted_at is null;
create index system_accounts_attention_ix on system_accounts (attention) where deleted_at is null and attention is not null;

create table access_reviews (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  status text not null default 'draft',
  owner_id uuid,
  starts_on date,
  due_on date,
  remind_days_before integer not null default 3,
  removal_days integer not null default 14,
  launched_at timestamptz,
  completed_on date,
  control_id uuid,
  control_test_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- One system in a campaign, with the person asked to review its accounts.
create table access_review_systems (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references access_reviews(id) on delete cascade,
  system_id uuid not null,
  reviewer_id uuid,
  signed_off_by uuid,
  signed_off_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index access_review_systems_ux on access_review_systems (review_id, system_id);
create index access_review_systems_reviewer_ix on access_review_systems (reviewer_id) where signed_off_at is null;

-- One account in a campaign: a copy of the account as it was at launch, and the decision on it.
create table access_review_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references access_reviews(id) on delete cascade,
  review_system_id uuid not null references access_review_systems(id) on delete cascade,
  system_id uuid not null,
  account_id uuid not null,
  account_name text,
  display_name text,
  holder_person_id uuid,
  account_kind text,
  role_on_system text,
  privileged boolean not null default false,
  last_seen_on date,
  attention text,
  decision text,
  decided_by uuid,
  decided_at timestamptz,
  comment text,
  removal_status text,
  removal_due_on date,
  removed_by uuid,
  removed_at timestamptz,
  removal_note text,
  action_id uuid,
  created_at timestamptz not null default now()
);
create unique index access_review_items_ux on access_review_items (review_id, account_id);
create index access_review_items_system_ix on access_review_items (review_system_id);
create index access_review_items_removal_ix on access_review_items (removal_status) where removal_status = 'pending';
create index access_review_items_action_ix on access_review_items (action_id) where action_id is not null;
