-- E40-07: sessions and one-time links are looked up by person (the users list, every "sign out
-- everywhere"); expired sessions and used or expired links are removed by the daily job
-- core.session_cleanup, which finds them by their expiry.
create index if not exists sessions_user_ix on sessions (user_id, expires_at);
create index if not exists sessions_expires_ix on sessions (expires_at);
create index if not exists one_time_tokens_user_ix on one_time_tokens (user_id);
create index if not exists one_time_tokens_expires_ix on one_time_tokens (expires_at);

-- E40-06: the Audit page filters by person and by action, newest first.
create index if not exists audit_events_actor_ix on audit_events (actor_id, id desc) where actor_id is not null;
create index if not exists audit_events_action_ix on audit_events (action, id desc);

-- E40-06: the audit log stays append-only. The one exception is the audit archive
-- (core/audit-archive.ts), which, after writing old events to a checked file, removes them in a
-- transaction that sets `grc.audit_archive` to `on` for that transaction only. A least-privilege
-- run-time role (docs/installation.md) has no delete privilege on this table at all, so the
-- exception does not reach it.
create or replace function audit_events_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('grc.audit_archive', true), '') = 'on' then
    return old;
  end if;
  raise exception 'audit_events is append-only';
end $$;
