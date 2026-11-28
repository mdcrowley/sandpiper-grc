-- Strategy and performance (wave 26): the strategic plan register and operating statistics.
--
-- strategy_plans: a strategic plan for a period, adopted by a board decision (governance module,
--   meeting_decision) and kept as a controlled document (policies module, policy).
-- strategy_goals, strategy_objectives: the plan's goals and the objectives under each goal. An
--   objective's current status is the status of its latest quarterly update.
-- strategy_measures: the measures (key performance indicators) of an objective, with unit, direction,
--   baseline and data source: entered by hand, or taken from a metric another module offers
--   (core/metrics.ts) or a figure recorded over time (reports module, tracked_figures).
-- strategy_measure_values: one row per measure and period: its target and, once known, its actual.
-- strategy_initiatives: the initiatives under an objective, linked to a project, a budget line and
--   actions (actions point back with source_type = 'strategic_initiative').
-- strategy_updates: quarterly status updates of an objective or an initiative.
-- strategy_stat_series, strategy_stat_values: operating statistics an administrator defines (unit,
--   frequency, breakdowns such as mode or service) and the values entered per period.
-- strategy_submissions: periodic statistical reports to outside bodies, with due dates and reminders.
-- No foreign keys to other modules' tables: their records are named by id only.

create table strategy_plans (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  period_start date,
  period_end date,
  status text,                     -- strategy_plan_status: draft | adopted | superseded | retired
  adopted_on date,
  document_id uuid,                -- the controlled document (policy) holding the plan
  decision_id uuid,                -- the board decision (meeting_decision) adopting it
  owner_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table strategy_goals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references strategy_plans(id),
  code text,
  title text not null,
  description text,
  owner_id uuid,
  sort numeric not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_goals_plan_ix on strategy_goals (plan_id) where deleted_at is null;

create table strategy_objectives (
  id uuid primary key default gen_random_uuid(),
  ref text,
  goal_id uuid not null references strategy_goals(id),
  plan_id uuid,                    -- copied from the goal
  code text,
  title text not null,
  description text,
  owner_id uuid,
  department_id uuid,
  target_date date,
  status text,                     -- strategy_rag of the latest update (null: not reported yet)
  status_period text,              -- the quarter of that update, YYYY-Qn
  sort numeric not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_objectives_goal_ix on strategy_objectives (goal_id) where deleted_at is null;
create index strategy_objectives_plan_ix on strategy_objectives (plan_id) where deleted_at is null;

create table strategy_measures (
  id uuid primary key default gen_random_uuid(),
  ref text,
  objective_id uuid not null references strategy_objectives(id),
  plan_id uuid,                    -- copied from the objective
  title text not null,
  description text,
  unit text,
  direction text,                  -- measure_direction: increase | decrease | maintain
  tolerance_pct numeric,           -- how far from the target still counts as near it (percent)
  frequency text,                  -- stat_frequency: monthly | quarterly | yearly
  baseline_value numeric,
  baseline_period text,
  source text,                     -- measure_source: manual | metric | figure
  metric_key text,                 -- source = metric
  figure_id uuid,                  -- source = figure (reports module, tracked_figures)
  owner_id uuid,
  latest_period text,
  latest_value numeric,
  latest_target numeric,
  latest_state text,               -- measure_state of the latest actual: met | near | missed | no_target
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_measures_objective_ix on strategy_measures (objective_id) where deleted_at is null;

create table strategy_measure_values (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null references strategy_measures(id),
  period text not null,            -- YYYY, YYYY-Qn or YYYY-MM, after the measure's frequency
  period_start date,
  period_end date,
  target numeric,
  actual numeric,
  state text,                      -- measure_state
  note text,
  value_source text,               -- measure_source the actual came from
  entered_by uuid,
  entered_by_name text,
  entered_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index strategy_measure_values_period_ux on strategy_measure_values (measure_id, period) where deleted_at is null;

create table strategy_initiatives (
  id uuid primary key default gen_random_uuid(),
  ref text,
  objective_id uuid not null references strategy_objectives(id),
  plan_id uuid,                    -- copied from the objective
  title text not null,
  description text,
  owner_id uuid,
  stage text,                      -- initiative_stage: planned | in_progress | completed | on_hold | canceled
  start_on date,
  end_on date,
  project_id uuid,                 -- projects module
  budget_line_id uuid,             -- a budget line (procurement module) when installed
  budget_reference text,           -- or the budget line's reference as text
  budget_amount numeric,
  status text,                     -- strategy_rag of the latest update
  status_period text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_initiatives_objective_ix on strategy_initiatives (objective_id) where deleted_at is null;

create table strategy_updates (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid,
  initiative_id uuid,
  plan_id uuid,                    -- copied from the objective or initiative
  period text not null,            -- YYYY-Qn
  status text not null,            -- strategy_rag: on_track | at_risk | off_track
  narrative text,
  reported_by uuid,
  reported_by_name text,
  reported_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_updates_objective_ix on strategy_updates (objective_id, period) where deleted_at is null;
create index strategy_updates_initiative_ix on strategy_updates (initiative_id, period) where deleted_at is null;

create table strategy_stat_series (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  description text,
  unit text,
  frequency text,                  -- stat_frequency
  breakdown_label text,            -- what the breakdowns are, for example "Mode"
  breakdowns text,                 -- the allowed breakdown values, one per line
  decimals integer,
  active boolean not null default true,
  owner_id uuid,
  sort numeric not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table strategy_stat_values (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references strategy_stat_series(id),
  period text not null,
  period_start date,
  period_end date,
  breakdown text not null default '',   -- '' is the total
  value numeric not null,
  note text,
  entered_by uuid,
  entered_by_name text,
  entered_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index strategy_stat_values_ux on strategy_stat_values (series_id, period, breakdown) where deleted_at is null;
create index strategy_stat_values_period_ix on strategy_stat_values (series_id, period_start) where deleted_at is null;

create table strategy_submissions (
  id uuid primary key default gen_random_uuid(),
  ref text,
  report_name text not null,
  recipient text,                  -- the outside body, as the organization names it
  period text,
  due_on date,
  owner_id uuid,
  status text,                     -- submission_status: planned | in_preparation | submitted | accepted | returned
  submitted_on date,
  submitted_by uuid,
  confirmation text,
  notes text,
  reminded_for date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index strategy_submissions_due_ix on strategy_submissions (due_on) where deleted_at is null;
