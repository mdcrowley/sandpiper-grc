-- Evidence entries can be edited (who and when), and review-date reminders remember which
-- review date they were last sent for, so each date is announced once ahead and once when due.

alter table outcome_evidence add column updated_at timestamptz;
alter table outcome_evidence add column updated_by uuid;

alter table framework_outcomes add column review_soon_sent_for date;
alter table framework_outcomes add column review_due_sent_for date;

create index outcome_mappings_name_ix on outcome_mappings (lower(framework_name));
