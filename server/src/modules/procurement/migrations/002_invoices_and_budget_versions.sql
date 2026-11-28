-- Procurement wave 27 (E46-66, E46-67): vendor invoices against purchase orders, matched with what was
-- received and approved before payment, and budget versions (the adopted budget and each amendment, with a
-- snapshot of every line). Other modules' records are plain uuid columns (no foreign keys across modules).

create table purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  ref text,
  purchase_order_id uuid not null,
  invoice_number text not null,       -- the vendor's own number
  invoice_date date not null,
  received_on date,
  due_on date,
  vendor_id uuid,                     -- copied from the order
  vendor_name text,
  department_id uuid,                 -- copied from the order (scope)
  amount numeric(14,2) not null default 0,
  status text,                        -- invoice_status, managed by the application
  match_status text,                  -- invoice_match: matched | exception | no_lines
  match_note text,
  entered_by uuid,
  entered_by_name text,
  submitted_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  approval_note text,                 -- why an invoice that does not match was approved
  rejected_reason text,
  paid_on date,
  payment_reference text,
  payment_method text,                -- payment_method
  paid_by uuid,
  paid_by_name text,
  voided_reason text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index purchase_invoices_po_ix on purchase_invoices (purchase_order_id) where deleted_at is null;
create index purchase_invoices_status_ix on purchase_invoices (status) where deleted_at is null;

create table purchase_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  po_line_id uuid not null,
  quantity numeric(14,3),             -- empty when the vendor bills an amount only (services)
  unit_price numeric(14,2),
  amount numeric(14,2) not null default 0,
  match_status text,
  match_note text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index purchase_invoice_lines_invoice_ix on purchase_invoice_lines (invoice_id) where deleted_at is null;
create index purchase_invoice_lines_po_line_ix on purchase_invoice_lines (po_line_id) where deleted_at is null;

-- A budget's versions: 0 is the adopted budget, then each amendment in order. The lines' amounts are the
-- latest version's; each version keeps every line's amount before and after it.
create table budget_versions (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null,
  version_no int not null default 0,
  kind text not null,                 -- budget_version_kind: adopted | amendment
  title text,
  effective_on date not null,
  approved_on date,
  decision text,                      -- the approval or board decision, in words
  decision_id uuid,                   -- governance: a committee decision
  document_id uuid,                   -- policies: the controlled document
  reason text,
  changes jsonb,                      -- what was asked: [{ budget_line_id, amount | change } | { title, kind, account, department_id, amount }]
  total_before numeric(14,2) not null default 0,
  total_after numeric(14,2) not null default 0,
  recorded_by uuid,
  recorded_by_name text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index budget_versions_budget_ix on budget_versions (budget_id, version_no) where deleted_at is null;

create table budget_version_lines (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references budget_versions(id) on delete cascade,
  budget_line_id uuid not null,
  amount_before numeric(14,2),        -- null: the line was added by this version
  amount_after numeric(14,2) not null
);
create index budget_version_lines_version_ix on budget_version_lines (version_id);
create index budget_version_lines_line_ix on budget_version_lines (budget_line_id);
