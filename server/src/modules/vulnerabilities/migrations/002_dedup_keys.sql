-- Duplicate key by host + port (and protocol) + finding identifier, host name and address
-- reconciled to one host, the criticality that shortened a fix-by date, and the marker for
-- the "past its fix-by date" notification. Additive and safe to run again: no row is removed
-- or merged, and a row that cannot be keyed (no port, no host) keeps the key it had.

alter table vulnerabilities add column if not exists protocol text;
-- "443/tcp", "443" when the protocol is not known, '' when the finding has no port.
alter table vulnerabilities add column if not exists port_key text not null default '';
-- The criticality value (of the finding's system) that shortened the fix-by date, when one did.
alter table vulnerabilities add column if not exists due_criticality text;
-- The fix-by date the owner has been told has passed (so nobody is told twice about one date).
alter table vulnerabilities add column if not exists overdue_notified_for date;

-- Port key for existing rows, from the port text: "445/tcp", "tcp/445", "445" and "445 (tcp)" forms.
update vulnerabilities set port_key = case
    when port ~ '^\s*0*\s*$' then ''
    when port ~ '^\s*\d+\s*$' then btrim(port)
    when port ~* '^\s*\d+\s*[/ (]\s*[a-z]+\s*\)?\s*$'
      then regexp_replace(lower(port), '^\s*(\d+)\s*[/ (]\s*([a-z]+)\s*\)?\s*$', '\1/\2')
    when port ~* '^\s*[a-z]+\s*[/ ]\s*\d+\s*$'
      then regexp_replace(lower(port), '^\s*([a-z]+)\s*[/ ]\s*(\d+)\s*$', '\2/\1')
    else lower(btrim(port))
  end
where port is not null and port_key = '';

-- A host recorded by address only takes the key of the named host with the same address, so
-- the two are one host from now on. The finding rows themselves are left as they are.
update vulnerabilities v set host_key = n.host_key
from (
  select distinct on (lower(btrim(host_ip))) lower(btrim(host_ip)) as ip, host_key
  from vulnerabilities
  where deleted_at is null and coalesce(btrim(host_name), '') <> '' and coalesce(btrim(host_ip), '') <> '' and host_key <> ''
  order by lower(btrim(host_ip)), last_seen desc nulls last, created_at desc
) n
where v.deleted_at is null and coalesce(btrim(v.host_name), '') = '' and lower(btrim(v.host_ip)) = n.ip and v.host_key <> n.host_key;

drop index if exists vulnerabilities_key_idx;
create index if not exists vulnerabilities_dedup_idx on vulnerabilities (host_key, finding_key, port_key) where deleted_at is null;
create index if not exists vulnerabilities_host_name_idx on vulnerabilities (lower(host_name)) where deleted_at is null;
create index if not exists vulnerabilities_host_ip_idx on vulnerabilities (lower(host_ip)) where deleted_at is null;

-- The view lists its columns when it is created, so it is rebuilt to carry the new ones.
drop view if exists vulnerability_records;
create view vulnerability_records as
select v.*,
  (coalesce(v.fixed_on, current_date) - v.first_seen) as age_days,
  (not v.closed and v.due_on is not null and v.due_on < current_date) as overdue
from vulnerabilities v;
