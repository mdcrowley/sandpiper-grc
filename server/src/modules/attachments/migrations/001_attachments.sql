-- Files attached to any record. The bytes live outside the database (see storage.ts);
-- this table holds what is needed to find, describe, check and authorize them.

create table attachments (
  id uuid primary key default gen_random_uuid(),
  -- The record the file belongs to. No foreign key: record types belong to other modules.
  record_type text not null,
  record_id uuid not null,
  -- Display name, sanitized. Never used to build a storage path.
  file_name text not null,
  extension text not null default '',
  -- Decided by the server from the extension, never taken from the browser.
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  sha256 text not null,
  storage_driver text not null default 'disk',
  -- Built from a random identifier: aa/bb/<32 hex characters>.
  storage_key text not null unique,
  kind text not null default 'file' check (kind in ('file', 'evidence')),
  description text,
  -- Evidence only: when it was collected and, optionally, when it stops being current.
  collected_on date,
  expires_on date,
  -- not_scanned | clean (a file found infected is refused and never gets a row)
  scan_status text not null default 'not_scanned',
  scan_engine text,
  scanned_at timestamptz,
  uploaded_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index attachments_record_ix on attachments (record_type, record_id) where deleted_at is null;
create index attachments_expiry_ix on attachments (expires_on) where deleted_at is null and kind = 'evidence';
