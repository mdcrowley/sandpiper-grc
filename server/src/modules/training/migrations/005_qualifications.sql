-- Qualifications (E29-02 to E29-06): what each position needs, people's certifications,
-- training for roster people and training assigned by position.

-- What a position (people module) needs: a course, or a certification of a type (list
-- certification_type, whose meta gives validity_months and issuing_body).
create table if not exists position_requirements (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null,              -- people module (no foreign key across modules)
  kind text not null,                     -- course | certification
  course_id uuid references courses(id),
  certification_type text,
  mandatory boolean not null default true,
  grace_days int not null default 0,      -- days after expiry that still count as in date
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists position_requirements_position_ix on position_requirements (position_id) where deleted_at is null;

create table if not exists certifications (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  person_id uuid not null,                -- people module
  certification_type text not null,
  number text,
  issuing_body text,
  issued_on date,
  expires_on date,
  status text not null default 'active',  -- certification_status: active | suspended | revoked
  notes text,
  reminded_for text,                      -- '<expires_on>:<step>' of the last expiry reminder sent
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists certifications_person_ix on certifications (person_id) where deleted_at is null;
create index if not exists certifications_expiry_ix on certifications (expires_on) where deleted_at is null;

-- Training for roster people: person_key 'p:<person id>' for someone without an account.
alter table training_records add column if not exists person_id uuid;
create index if not exists training_records_person_ix on training_records (person_id);
-- Assignment rules by position (audience_type 'position').
alter table training_assignments add column if not exists position_id uuid;
