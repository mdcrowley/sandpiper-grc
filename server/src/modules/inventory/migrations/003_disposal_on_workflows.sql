-- Disposal requests run on the shared approval workflows (E04-24). When a stand-in decided
-- (E14-32), the approver they stood in for, by name: "by <decided_by> on behalf of <name>". Additive.
alter table asset_disposal_requests add column if not exists decided_on_behalf_of_name text;
