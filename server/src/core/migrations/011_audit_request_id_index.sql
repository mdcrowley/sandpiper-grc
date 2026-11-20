-- Finding the audit events of one request (GET /api/audit?request_id=, E13-23).
create index if not exists audit_events_request_id_idx on audit_events (request_id) where request_id is not null;
