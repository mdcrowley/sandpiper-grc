-- Wave 19: remember which accounts provisioning created itself. Provisioning may deactivate such an
-- account even after it was given a role that can administer (a leaver must always be removable), but
-- never enables it again or changes its email address; an account it did not create, that can
-- administer, it still never deactivates.
alter table user_external_ids add column provisioned boolean not null default false;

-- Accounts created before this migration: the audit log names provisioning as their creator.
update user_external_ids x set provisioned = true
where x.source = 'scim' and exists (
  select 1 from audit_events a
  where a.action = 'user.create' and a.record_type = 'user' and a.record_id = x.user_id::text
    and a.actor_id is null and a.actor_name like 'Provisioning (%'
);
