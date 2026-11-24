-- Written test steps per control, and each step's result in a control test (E41-12).

-- The steps a tester follows to test a control, in order, with what they should find.
create table control_steps (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references controls (id) on delete cascade,
  sort integer not null default 0,
  step text not null,
  expected text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index control_steps_control_ix on control_steps (control_id, sort);

-- The steps as they were when a test was recorded (copied from the control, so a later change to
-- the control's steps never rewrites a past test), each with its result.
create table control_test_steps (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references control_tests (id) on delete cascade,
  step_id uuid,
  sort integer not null default 0,
  step text not null,
  expected text,
  result text,
  note text,
  done_by uuid,
  done_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index control_test_steps_test_ix on control_test_steps (test_id, sort);
