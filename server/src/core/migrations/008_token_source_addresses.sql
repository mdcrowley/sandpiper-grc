-- E02-18: a personal access token may be limited to source addresses and CIDR ranges
-- (a JSON array of strings such as "203.0.113.7" or "10.20.0.0/16"); null or empty = from anywhere.
alter table api_tokens add column if not exists allowed_sources jsonb;
