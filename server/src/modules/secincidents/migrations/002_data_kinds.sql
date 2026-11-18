-- E18-13: kinds of data an incident involves are configurable (lookup list incident_data_kind)
-- rather than built-in yes/no columns. The two former columns stay in place, unused.

alter table security_incidents add column data_kinds jsonb not null default '[]';

update security_incidents set data_kinds =
    (case when health_data_involved then '["health_information"]'::jsonb else '[]'::jsonb end)
 || (case when card_data_involved then '["payment_card_data"]'::jsonb else '[]'::jsonb end)
where health_data_involved or card_data_involved;

-- Starter rules for those two kinds that nobody has set up are withdrawn (soft-deleted, audited).
insert into audit_events (actor_name, action, record_type, record_id, summary)
select 'System', 'notification_rule.delete', 'notification_rule', id::text,
       'Unused starter notification rule withdrawn: ' || party
from notification_rules
where key in ('health_data_partner', 'card_acquirer') and deleted_at is null
  and not active and deadline_hours is null and updated_by is null;
update notification_rules set deleted_at = now()
where key in ('health_data_partner', 'card_acquirer') and deleted_at is null
  and not active and deadline_hours is null and updated_by is null;

update notification_rules set trigger_attribute = 'kind:health_information' where trigger_attribute = 'health_data_involved';
update notification_rules set trigger_attribute = 'kind:payment_card_data' where trigger_attribute = 'card_data_involved';

-- Keep the two kinds only where an existing rule or incident uses them.
insert into lookups (list_key, value, label, sort)
select 'incident_data_kind', 'health_information', 'Health information', 100
where exists (select 1 from notification_rules where trigger_attribute = 'kind:health_information' and deleted_at is null)
   or exists (select 1 from security_incidents where jsonb_exists(data_kinds, 'health_information'))
on conflict (list_key, value) do nothing;
insert into lookups (list_key, value, label, sort)
select 'incident_data_kind', 'payment_card_data', 'Payment card data', 110
where exists (select 1 from notification_rules where trigger_attribute = 'kind:payment_card_data' and deleted_at is null)
   or exists (select 1 from security_incidents where jsonb_exists(data_kinds, 'payment_card_data'))
on conflict (list_key, value) do nothing;

-- The former trigger labels are retired, not removed.
update lookups set active = false
where list_key = 'notification_trigger' and value in ('health_data_involved', 'card_data_involved');
