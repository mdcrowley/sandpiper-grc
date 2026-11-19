-- The request id (X-Request-Id) of the call that caused each audit event, for tracing integrations.
alter table audit_events add column if not exists request_id text;
