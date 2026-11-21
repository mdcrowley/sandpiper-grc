-- Wave 8 (E14-32, E14-37): steps that run side by side, and status moves that wait for approval.
-- Additive: definitions keep their shape (a step may now also carry `branches` and `routes`), and
-- workflows already running keep working.

-- A step that runs branches side by side has one row per branch at the same position: `branch` is
-- the branch's index in the definition (null for an ordinary step) and `group_name` the step's name.
alter table workflow_steps add column if not exists branch int;
alter table workflow_steps add column if not exists group_name text;
alter table workflow_steps drop constraint if exists workflow_steps_instance_id_position_key;
create unique index if not exists workflow_steps_position_branch_uq on workflow_steps (instance_id, position, coalesce(branch, -1));

-- A status move held until a workflow approves it (E14-37) is a running workflow whose `data`
-- holds `{ move: { field, from, to } }`; this finds the one waiting on a record quickly.
create index if not exists workflow_instances_moves_ix on workflow_instances (record_type, record_id)
  where status = 'running' and (data -> 'move') is not null;
