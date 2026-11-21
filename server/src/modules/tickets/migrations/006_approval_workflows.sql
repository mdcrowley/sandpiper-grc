-- E03-22: catalog request approvals run on the shared approval workflows. An item names the
-- approval workflow (of kind `ticket_approval`) that decides its requests; null = the catalog
-- request approval workflow that fits best. approvals_needed and approver_ids stay for the
-- requests decided before the move (the workflows module's install turned them into workflows).
alter table catalog_items add column if not exists approval_workflow_id uuid;
