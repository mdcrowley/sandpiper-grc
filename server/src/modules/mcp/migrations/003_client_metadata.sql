-- E21-21 Client ID metadata documents: connectors whose client_id is the https address of a JSON
-- document describing them. They are kept in mcp_oauth_clients (registered_by = 'metadata') as a
-- cache of the last valid document, refreshed when it expires.
alter table mcp_oauth_clients add column if not exists pending boolean not null default false;
alter table mcp_oauth_clients add column if not exists metadata_fetched_at timestamptz;
alter table mcp_oauth_clients add column if not exists metadata_expires_at timestamptz;
alter table mcp_oauth_clients add column if not exists approved_at timestamptz;
alter table mcp_oauth_clients add column if not exists approved_by uuid;
