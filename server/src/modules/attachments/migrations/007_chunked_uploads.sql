-- E43-07: chunked uploads (uploads.ts). A large file, or one sent by an AI assistant over MCP as base64,
-- arrives in numbered parts of at most 1 MB. Each part is kept in the file store under its own random
-- key until the upload is finished; finishing joins the parts into one stored file, checks its
-- SHA-256 and content and runs the malware scanner, as a single upload would. A finished upload is
-- attached to a record the first time it is used, under that record's rules, and only by the person
-- who sent it. Uploads not finished or not used within 24 hours are removed with their bytes.
--   status  receiving | ready (finished, not used yet) | used (attached) | failed (refused at finish)
--   parts   { "<n>": { "key": storage key, "size": bytes, "sha256": hex } }
--   file    once ready: the stored file (driver, key, size, sha256, content type, scan status)
create table uploads_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token_id uuid,
  file_name text not null,
  extension text not null,
  size bigint not null,
  sha256 text,
  part_size integer not null,
  part_count integer not null,
  parts jsonb not null default '{}'::jsonb,
  parts_driver text not null,
  status text not null default 'receiving' check (status in ('receiving', 'ready', 'used', 'failed')),
  file jsonb,
  storage_key text,
  attachment_id uuid,
  detail text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz,
  used_at timestamptz
);
create index uploads_pending_user_ix on uploads_pending (user_id, status);
create index uploads_pending_expiry_ix on uploads_pending (expires_at);
