-- Strategy and performance, wave 27.
--
-- E46-58 fiscal-year quarters: a status update keeps the first and last day of its quarter, like
--   measure and statistic values do, so updates order by date whatever kind of year their period is
--   written on (YYYY-Qn on the calendar year, FYYYYY-Qn on a fiscal year). Updates entered so far
--   are all on the calendar year.
-- E46-59 measures from statistics series: a measure's data source can be a statistics series, with
--   the breakdown it takes (empty: the total) and how the series' values within one of the measure's
--   periods are combined (sum, average, latest, lowest, highest).

alter table strategy_updates add column period_start date;
alter table strategy_updates add column period_end date;

update strategy_updates
   set period_start = make_date(substr(period, 1, 4)::int, (substr(period, 7, 1)::int - 1) * 3 + 1, 1)
 where period ~ '^[0-9]{4}-Q[1-4]$';
update strategy_updates
   set period_end = (period_start + interval '3 months' - interval '1 day')::date
 where period_start is not null;

create index strategy_updates_period_ix on strategy_updates (plan_id, period_start) where deleted_at is null;

alter table strategy_measures add column series_id uuid;           -- source = series (strategy_stat_series)
alter table strategy_measures add column series_breakdown text;    -- one of the series' breakdowns; null or '' = the total
alter table strategy_measures add column series_aggregation text;  -- measure_aggregation: sum | average | latest | min | max
