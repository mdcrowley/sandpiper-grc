-- Routed disposal approval: a request an approver decides in the application,
-- and a record of the date reminders already sent so each goes out once.

alter table assets add column disposal_request_status text;

create table asset_disposal_requests (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id),
  status text not null default 'pending',  -- pending | approved | refused | withdrawn
  reason text,
  disposal_method text,
  approval_ref text,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text
);
create index asset_disposal_requests_asset_ix on asset_disposal_requests (asset_id, requested_at desc);
create unique index asset_disposal_requests_pending_ux on asset_disposal_requests (asset_id) where status = 'pending';

-- kind: warranty_end | support_end | loan. threshold: the "days before" step that was sent.
create table asset_reminders (
  asset_id uuid not null,
  kind text not null,
  due_on date not null,
  threshold integer not null,
  sent_at timestamptz not null default now(),
  primary key (asset_id, kind, due_on, threshold)
);
