-- Wave 26: plans started from a built-in template (templates.ts). `body` holds the plan's other
-- sections (roles, communications, recovery objectives, alternate sites, return to normal, plan
-- maintenance and exercising, and for disaster recovery the systems, tiers and restore steps);
-- `template_key` names the template the plan was started from, kept for the record.
alter table continuity_plans add column if not exists body text;
alter table continuity_plans add column if not exists template_key text;
