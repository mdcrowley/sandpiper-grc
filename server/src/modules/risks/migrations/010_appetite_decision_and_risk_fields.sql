-- Wave 26: an appetite version tied to the committee decision that approved it (E45-56), and three
-- further risk fields (E45-57): proximity (when it could happen), velocity (how fast it would hit) and
-- the strategic objective it threatens.
alter table risk_appetite add column if not exists decision_id uuid;
alter table risk_appetite_versions add column if not exists decision_id uuid;
alter table risks add column if not exists proximity text;
alter table risks add column if not exists velocity text;
alter table risks add column if not exists strategic_objective text;
