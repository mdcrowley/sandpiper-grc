-- Document control (E43): distribution groups, department codes and number sequences, bulk imports.
create table if not exists document_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid,
  roles jsonb not null default '[]',          -- role keys whose holders are in the group
  departments jsonb not null default '[]',    -- department ids (and those below them) whose people are in the group
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index if not exists document_groups_name_ux on document_groups (lower(name)) where deleted_at is null;

create table if not exists document_group_members (
  group_id uuid not null references document_groups(id),
  user_id uuid not null,
  added_at timestamptz not null default now(),
  added_by uuid,
  primary key (group_id, user_id)
);
create index if not exists document_group_members_user_ix on document_group_members (user_id);

-- Short department codes for document numbers (SOP-IT-014). Department ids are core ids (no foreign key).
create table if not exists document_department_codes (
  department_id uuid primary key,
  code text not null
);
create unique index if not exists document_department_codes_code_ux on document_department_codes (upper(code));

-- The next number per (document type, department code); empty code when the pattern has no department.
create table if not exists document_number_sequences (
  type text not null,
  dept_code text not null default '',
  next int not null default 1,
  primary key (type, dept_code)
);

-- Bulk imports of document packages (a .zip of files and manifest.csv): one row per run.
create table if not exists document_imports (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  dry_run boolean not null default false,
  file_count int not null default 0,
  rows jsonb not null default '[]',
  results jsonb not null default '[]',
  created_at timestamptz not null default now(),
  created_by uuid,
  finished_at timestamptz
);
