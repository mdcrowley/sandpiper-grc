-- E08-16: an action takes its restriction from the record it arose from, so the title of an
-- action raised on a restricted record is hidden from people without security.view.
-- Core fills the flag at every start for existing rows and keeps it in step afterwards.
alter table actions add column restricted boolean not null default false;
create index actions_restricted_ix on actions (restricted) where restricted;

-- E18-13: the second built-in scale carried a short key taken from one sector. Give it a
-- self-explanatory key everywhere the key is stored.
insert into risk_scales (key, name, description, likelihood_label, impact_label, likelihood_levels, impact_levels, matrix, sort, created_at, updated_at, updated_by)
  select 'hazard_4x5', name, description, likelihood_label, impact_label, likelihood_levels, impact_levels, matrix, sort, created_at, updated_at, updated_by
  from risk_scales where key = 'asp' and not exists (select 1 from risk_scales where key = 'hazard_4x5');
update risk_scale_ratings set scale_key = 'hazard_4x5' where scale_key = 'asp';
update risks set scale_key = 'hazard_4x5' where scale_key = 'asp';
insert into audit_events (actor_name, action, record_type, record_id, summary, before, after)
  select 'System', 'risk_scale.update', 'risk_scale', 'hazard_4x5', 'Risk scale key changed to hazard_4x5',
         '{"key":"asp"}'::jsonb, '{"key":"hazard_4x5"}'::jsonb
  from risk_scales where key = 'asp';
delete from risk_scales where key = 'asp';
update lookups set meta = jsonb_set(meta, '{scale}', '"hazard_4x5"') where list_key = 'risk_category' and meta->>'scale' = 'asp';
update settings set value = (value - 'asp') || jsonb_build_object('hazard_4x5', value->'asp')
  where key = 'risks.acceptance_thresholds' and jsonb_exists(value, 'asp');
