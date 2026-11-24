-- E41-04: figures over time for board reporting.
--
-- tracked_figures: the figures an organization chooses to record. A figure is either a count of
--   records of one type matching filters, optionally broken down by one of its list fields (for
--   example open risks by level), or a named metric another module offers (core/metrics.ts).
-- figure_values: what each figure was at a month end (recorded by the month-end job) or when
--   someone asked (on demand, for the month so far). Figures count every record, restricted or
--   not, and are the same for everyone; a breakdown holds list values and counts only.

create table tracked_figures (
  id uuid primary key default gen_random_uuid(),
  key text unique,                       -- set on the standard figures the seed creates, null otherwise
  name text not null,
  description text,
  source text not null default 'count',  -- count | metric
  metric_key text,                       -- source = metric
  record_type text,                      -- source = count
  filters jsonb,                         -- source = count: the report engine's filter tree
  group_field text,                      -- source = count: a list field to break the count down by
  active boolean not null default true,  -- recorded at month end
  sort numeric not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table figure_values (
  id uuid primary key default gen_random_uuid(),
  figure_id uuid not null references tracked_figures(id) on delete cascade,
  period date not null,                  -- the first day of the month the value belongs to
  kind text not null,                    -- month_end | on_demand
  value numeric,                         -- null when it could not be worked out (a percentage of nothing)
  groups jsonb,                          -- breakdown: [{ value, label, color, count }]
  recorded_at timestamptz not null default now(),
  recorded_by uuid,                      -- null for the month-end job
  unique (figure_id, period, kind)
);
create index figure_values_period on figure_values (figure_id, period);
