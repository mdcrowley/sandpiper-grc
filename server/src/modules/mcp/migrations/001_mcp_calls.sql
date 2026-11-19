-- AI assistant access (MCP): one row per tool call or resource read made through /mcp.
-- Kept for the per-token call log on the administrators' screen; rows older than 90 days are removed.

create table mcp_calls (
  id bigserial primary key,
  at timestamptz not null default now(),
  -- The personal access token used (core api_tokens.id) and its name at the time.
  token_id uuid not null,
  token_name text not null,
  user_id uuid not null,
  -- Tool name, or "read_resource" for a resource read.
  tool text not null,
  ok boolean not null,
  -- Short error code or message when the call failed; never the arguments or the result.
  error text,
  duration_ms integer not null default 0
);
create index mcp_calls_token_ix on mcp_calls (token_id, at desc);
create index mcp_calls_at_ix on mcp_calls (at desc);
