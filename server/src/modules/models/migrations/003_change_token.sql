-- E40-13: a background change of a model saved with an access token runs with that token's scope.
-- The token (and its scopes when it was used) is recorded with the change.
alter table model_changes add column if not exists via_token_id uuid;
alter table model_changes add column if not exists via_token_name text;
alter table model_changes add column if not exists via_token_scopes jsonb;
