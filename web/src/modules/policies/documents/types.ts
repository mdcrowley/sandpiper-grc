// Shapes of the document-control routes (E43), as in the server contract. One place for them, so a
// change in the server contract is a change here.
import type { PolicyVersion } from '../shared';

/** Tiers of the document hierarchy, from the type list's meta.tier. */
export const TIER_LABEL: Record<string, string> = {
  '1': 'Policies and plans',
  '2': 'Standards and programs',
  '3': 'Procedures',
  '4': 'Instructions, guidelines and forms',
  X: 'External documents',
  R: 'Reference documents',
};
export const TIER_ORDER = ['1', '2', '3', '4', 'X', 'R'];

export type Access = 'organization' | 'restricted';

/** One row of the library: a published (or, when asked, obsolete) document the viewer may read. */
export interface LibraryRow {
  id: string;
  ref: string | null;
  doc_number: string | null;
  title: string;
  summary?: string | null;
  document_type: string | null;
  type_label?: string | null;
  tier?: string | number | null;
  owning_department_id?: string | null;
  department_name?: string | null;
  status: string;
  access: Access;
  restricted?: boolean;
  version?: number | null;
  version_label?: string | null;
  effective_on?: string | null;
  next_review_on?: string | null;
  retired_on?: string | null;
  /** A few words around the match in the text (plain text, never HTML). */
  excerpt?: string | null;
}

export interface LibraryResult { rows: LibraryRow[]; total: number; page: number; pageSize: number }

/** Counts of what the viewer can open, by type and by owning department. */
export interface LibraryTree {
  types: { value: string; label: string; tier: string | number | null; count: number }[];
  departments: { id: string; name: string; count: number }[];
  total: number;
}

/** The version keys added for document control (the older keys are in PolicyVersion). */
export interface VersionExtras {
  version_label?: string | null;
  superseded_on?: string | null;
  withdrawn_on?: string | null;
  approval_body?: string | null;
  approval_reference?: string | null;
  minor?: boolean;
  content_kind?: 'markdown' | 'file';
  source_attachment_id?: string | null;
  rendition_attachment_id?: string | null;
  conversion?: ConversionReport | null;
  body_sha256?: string | null;
  scheduled?: boolean;
  reviewed_no_change_on?: string | null;
  updated_at?: string;
}

/** A version as the reading page gets it: the text only for the version being read. */
export type DocVersion = Omit<PolicyVersion, 'body' | 'body_html'> & VersionExtras & { body?: string; body_html?: string };
/** A version from GET /api/policies/:id/versions, always with its text. */
export type FullVersion = PolicyVersion & VersionExtras;

export interface ReaderDocument {
  id: string; ref: string | null; doc_number: string | null; title: string; summary: string | null;
  document_type: string | null; type_label: string | null; tier: string | number | null; status: string; access: Access;
  owner_id: string | null; owner_name: string | null; owning_department_id: string | null; department_name: string | null;
  approver_name: string | null; approver_role: string | null; next_review_on: string | null; last_reviewed_on: string | null;
  retired_on: string | null; retire_reason: string | null; replaced_by: { id: string; doc_number: string | null; title: string } | null;
  ack_required: boolean; publisher: string | null; edition: string | null; published_on: string | null; source_url: string | null;
  license_note: string | null; expires_on: string | null; uncontrolled: boolean; can_edit: boolean;
}

/** GET /api/documents/library/:id */
export interface ReaderView {
  document: ReaderDocument;
  version: DocVersion | null;
  versions: DocVersion[];
  banner: null | { kind: 'superseded' | 'obsolete' | 'reference' | 'scheduled'; text: string };
}

export interface HierarchyNode {
  id: string; ref: string | null; doc_number: string | null; title: string; document_type: string | null;
  tier?: string | number | null; status: string; retired_on?: string | null; child_count?: number;
}

/** GET /api/policies/:id/hierarchy */
export interface Hierarchy {
  document: HierarchyNode;
  ancestors: HierarchyNode[];
  children: HierarchyNode[];
  /** Children the viewer cannot open: a figure, never named. */
  hidden_children: number;
  tier_warning: string | null;
}

/** GET /api/policies/:id/relationships */
export interface Relationships {
  groups: {
    relation: string; label: string; hidden: number;
    items: { type: string; typeLabel: string; id: string; label: string; ref: string | null; route: string | null; direction: string }[];
  }[];
  parent: HierarchyNode | null;
  children: HierarchyNode[];
  hidden_children: number;
}

export interface AccessList {
  access: Access;
  access_departments: string[];
  access_roles: string[];
  access_groups: string[];
  access_users: string[];
}

/** GET /api/policies/:id/access */
export interface AccessView {
  access: Access;
  departments: { id: string; name: string }[];
  roles: { key: string; name: string }[];
  groups: { id: string; name: string }[];
  users: { id: string; name: string }[];
  reader_count: number;
  can_change: boolean;
  audience_outside: string[];
  closed?: number;
}

export interface DistributionGroup {
  id: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  owner_name?: string | null;
  roles: string[];
  departments: string[];
  member_count: number;
  document_count: number;
  members?: { user_id: string; name: string; added_at?: string }[];
}

export interface DocumentReview {
  id: string;
  kind: 'plan_annual' | 'periodic';
  result: 'no_change' | 'revise' | 'retire' | null;
  outcome?: string | null;
  review_year?: number | null;
  started_on?: string | null;
  reviewed_on: string | null;
  approved_on?: string | null;
  reviewed_by_name: string | null;
  note: string | null;
  version?: number | null;
}

export interface ReviewDue {
  id: string; ref: string | null; doc_number: string | null; title: string; document_type: string | null;
  owner_id: string | null; owner_name: string | null; next_review_on: string | null; last_reviewed_on: string | null;
  days_left: number; state: 'overdue' | 'due';
}

export interface ApprovalRow {
  policy_id: string; ref: string | null; doc_number: string | null; title: string; version_id: string; version: number;
  version_label: string | null; status: string; author_name: string | null; created_by: string | null; updated_at: string; own: boolean;
}

/** GET /api/documents/summary: figures, the same for every viewer. */
export interface DocSummary {
  effective: number; in_review: number; review_overdue: number; review_due_90: number; obsolete: number; without_owner: number;
  total: number; by_type: { value: string; label: string; count: number }[]; ack_completion_pct: number | null;
}

export interface ConversionReport {
  converter?: string;
  warnings?: ({ code?: string; message: string } | string)[];
  images?: number | unknown[];
  tracked_changes?: boolean;
  comments?: number;
  suggested?: Record<string, string>;
  [key: string]: unknown;
}

export interface ConversionResult { markdown: string; html?: string; report: ConversionReport }

/** "SOP-IT-014", or the internal reference while the document has no number. */
export const docNumber = (r: { doc_number?: string | null; ref?: string | null; id?: string }): string => r.doc_number || r.ref || '';

/** The reading page of a document, open to every reader. */
export const readerPath = (id: string) => `/documents/${id}`;
/** The record page with every tab, for the people who keep the register. */
export const recordPath = (id: string) => `/policies/${id}`;

/** Messages of a conversion report as plain sentences. */
export const reportWarnings = (r: ConversionReport | null | undefined): string[] =>
  (r?.warnings ?? []).map((w) => (typeof w === 'string' ? w : w.message)).filter(Boolean);
