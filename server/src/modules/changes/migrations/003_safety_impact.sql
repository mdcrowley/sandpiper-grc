-- Safety risk management on changes (wave 10, E25-11): whether a change affects safety, set from
-- the risk questionnaire's safety question (or by hand). While the safety area is on, such a change
-- needs a hazard linked as its safety assessment before it is submitted for approval, scheduled or started.
alter table changes add column safety_impact boolean not null default false;
