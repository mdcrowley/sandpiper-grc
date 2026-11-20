-- What the retention review of a flagged record may do, per record type (E14-19):
--   keep      - only keep it for longer;
--   anonymize - keep it longer, or anonymize it (personal fields, comments and files replaced, figures kept);
--   delete    - keep it longer, anonymize it, or remove it for good (what every type allowed before).
-- A review decided by anonymizing has the status 'anonymized'.
alter table retention_policies add column disposal text not null default 'delete';
