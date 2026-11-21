-- The staff roster (E29-01) and positions (E29-02). A person may or may not have an account;
-- name and contact fields are personal data (anonymized at the end of the retention period).
create table people (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  full_name text not null,
  preferred_name text,
  employee_number text,
  email text,
  phone text,
  department_id uuid,                -- core departments (no foreign key: core table, soft deletes)
  position_id uuid,                  -- positions in this module
  work_site_id uuid,                 -- inventory site (other module: no foreign key)
  user_id uuid,                      -- the person's account, when they have one
  supervisor_person_id uuid,
  hire_date date,
  status text not null default 'active',   -- lookup person_status: active | on_leave | left
  source text not null default 'manual',   -- lookup person_source: manual | import | account
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index people_employee_number_uq on people (lower(employee_number))
  where deleted_at is null and employee_number is not null and employee_number <> ''
    and employee_number <> 'Removed at the end of the retention period'; -- anonymized people (core/retention.ts)
create unique index people_user_uq on people (user_id) where deleted_at is null and user_id is not null;
create index people_email_ix on people (lower(email)) where deleted_at is null;
create index people_position_ix on people (position_id);
create index people_department_ix on people (department_id);

create table positions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  name text not null,
  code text,
  department_id uuid,
  description text,
  safety_sensitive boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index positions_name_uq on positions (lower(name)) where deleted_at is null;
