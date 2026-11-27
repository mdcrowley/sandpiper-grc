-- A control test may be part of an audit engagement (E45-17, wave 25): the audit is in the audits module,
-- so a plain uuid column. Such a test is reviewed like any other, by someone other than its tester who
-- may also work on audits, and the audit closes only once its control tests are reviewed. The
-- reviewer's name is kept beside the account, for a reviewer a data load names who has none.
alter table control_tests add column if not exists audit_id uuid;
alter table control_tests add column if not exists reviewer_name text;
create index if not exists control_tests_audit_ix on control_tests (audit_id) where deleted_at is null and audit_id is not null;
