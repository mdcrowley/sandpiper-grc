-- E11-25: a gate template may name an approval workflow (kind `project_gate`, workflows module).
-- With one named, a gate whose checklist and required documents are complete can ask for approval
-- through it; its outcome is recorded as a gate decision. Without one (the default, and every
-- template that existed before), decisions are recorded by hand as before. No foreign key across modules.
alter table project_gate_defs add column if not exists approval_workflow_id uuid;
