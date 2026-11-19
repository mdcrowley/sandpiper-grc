create table courses (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  category text,
  provider text,
  format text,
  duration_minutes int,
  recurrence_months int,            -- null or 0 = taken once
  due_days int,                     -- days allowed to complete once assigned
  mandatory boolean not null default false,
  owner_id uuid,
  status text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- A rule: everyone, one role, one department or one person must take the course.
create table training_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  audience_type text not null,      -- everyone | role | department | user
  role_id uuid,
  department_id uuid,
  user_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index training_assignments_course_ix on training_assignments (course_id);

-- One row per person per time the course is due. A person is a user, or a name and
-- email for someone who has no account.
create table training_records (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  user_id uuid,
  person_name text,
  person_email text,
  person_department text,
  person_key text not null,         -- u:<user id> | e:<email> | n:<name>, lower case
  assigned_on date,
  due_on date,
  completed_on date,
  score numeric,
  result text,
  evidence_note text,
  source text not null default 'manual',   -- manual | import | rule
  assignment_id uuid,
  renewal_id uuid,                  -- the record raised when this completion ran out
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index training_records_course_ix on training_records (course_id, person_key);
create index training_records_user_ix on training_records (user_id);
create index training_records_due_ix on training_records (due_on);

create table exercises (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  type text,
  status text,
  exercise_date date,
  scenario text,
  scope text,
  facilitator text,
  objectives text,
  result text,
  outcome text,
  next_due_on date,
  owner_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index exercises_date_ix on exercises (exercise_date);

create table exercise_participants (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id),
  name text not null,
  role text,
  attended boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index exercise_participants_exercise_ix on exercise_participants (exercise_id);

create table exercise_findings (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id),
  finding text not null,
  severity text,
  recommendation text,
  action_id uuid,                   -- follow-up action raised from this finding (no foreign key: other module)
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index exercise_findings_exercise_ix on exercise_findings (exercise_id);
