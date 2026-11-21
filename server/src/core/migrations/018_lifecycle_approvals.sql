-- E14-37: a lifecycle move may wait for an approval workflow. Each entry names a move between two
-- statuses and the approval workflow (workflow_definitions.id, kept as a plain uuid: the workflows
-- module may not be loaded) that must approve it before the record takes the new status.
-- Additive: rules saved before have no approvals, so every move behaves as it did.
alter table lifecycle_rules add column if not exists approvals jsonb not null default '[]';  -- [[from, to, workflow id], ...]
