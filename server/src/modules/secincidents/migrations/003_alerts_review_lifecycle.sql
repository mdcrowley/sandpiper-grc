-- E09-17: remember when a clock's amber and red alerts were raised, so each is sent once.
alter table notification_tasks add column alerted_amber_at timestamptz;
alter table notification_tasks add column alerted_red_at timestamptz;

-- E09-22: post-incident review.
alter table security_incidents add column root_cause text;
alter table security_incidents add column review_status text not null default 'not_started';
alter table security_incidents add column review_due_on date;
alter table security_incidents add column review_held_at timestamptz;
alter table security_incidents add column review_lead_id uuid;
alter table security_incidents add column review_attendees text;
alter table security_incidents add column review_skip_reason text;
alter table security_incidents add column review_completed_at timestamptz;
alter table security_incidents add column review_completed_by uuid;

-- E09-18: what each lifecycle status means is data (lookup meta "stage"), not a constant in code.
-- Databases created before this migration already hold the five starter statuses without a stage.
update lookups set meta = coalesce(meta, '{}'::jsonb) || '{"stage":"reported"}'::jsonb
where list_key = 'security_incident_status' and value = 'reported' and not jsonb_exists(coalesce(meta, '{}'::jsonb), 'stage');
update lookups set meta = coalesce(meta, '{}'::jsonb) || '{"stage":"declared"}'::jsonb
where list_key = 'security_incident_status' and value = 'declared' and not jsonb_exists(coalesce(meta, '{}'::jsonb), 'stage');
update lookups set meta = coalesce(meta, '{}'::jsonb) || '{"stage":"contained"}'::jsonb
where list_key = 'security_incident_status' and value in ('contained', 'recovering') and not jsonb_exists(coalesce(meta, '{}'::jsonb), 'stage');
update lookups set meta = coalesce(meta, '{}'::jsonb) || '{"stage":"closed"}'::jsonb
where list_key = 'security_incident_status' and value = 'closed' and not jsonb_exists(coalesce(meta, '{}'::jsonb), 'stage');
