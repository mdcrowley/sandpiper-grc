// Shapes the record screens read from the server (GET /api/meta, generated resource routes, the
// workflow and policy acknowledgment routes). Owner: APP-WORK.

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'lookup' | 'user' | 'ref' | 'json';

export interface FieldMeta {
  label: string;
  type: FieldType;
  required?: boolean;
  default?: unknown;
  readOnly?: boolean;
  list?: string;
  to?: string;
  custom?: boolean;
  multiple?: boolean;
  /** The type offers this field on the phone edit form (spec §5.4). */
  mobileEditable?: boolean;
}

export interface LifecycleMeta {
  field: string;
  managed: boolean;
  blocked: [string, string][];
  required: Record<string, string[]>;
  denied: string[];
}

export interface ResourceMeta {
  type: string;
  label: string;
  plural: string;
  module: string;
  path: string;
  route: string;
  titleField: string;
  refField?: string;
  restricted: boolean | 'flag';
  fields: Record<string, FieldMeta>;
  lifecycle?: LifecycleMeta | null;
}

export interface LookupValue { value: string; label: string; color?: string | null; sort?: number }

export interface Meta {
  resources: Record<string, ResourceMeta>;
  lookups: Record<string, LookupValue[]>;
}

export type RecordRow = Record<string, unknown> & {
  id: string;
  updated_at?: string;
  _display?: Record<string, string | null>;
};

export interface SearchHit {
  type: string;
  typeLabel: string;
  id: string;
  label: string;
  ref: string | null;
  route: string;
  snippet?: string | null;
  matched?: 'record' | 'comment' | 'attachment';
}

export interface HistoryEvent { id: string; at: string; actor_name: string | null; action: string; summary: string }
export interface CommentRow { id: string; body: string; internal: boolean; author_name: string | null; created_at: string }
export interface AttachmentRow {
  id: string; file_name: string; size_bytes: number; kind: 'file' | 'evidence'; description: string | null;
  uploaded_by_name: string | null; uploaded_at: string;
}

/** One step waiting for the person (GET /api/workflows/approvals). */
export interface ApprovalItem {
  step_id: string;
  instance_id: string;
  workflow: string;
  step: string;
  position: number;
  steps_total: number;
  record_type: string;
  record_type_label: string;
  record_id: string;
  record_ref: string | null;
  record_title: string;
  route: string;
  requested_by_name: string | null;
  started_at?: string | null;
  due_at: string | null;
  overdue: boolean;
  approvals: number;
  required: number | null;
  kind_label: string | null;
  on_behalf_of_name: string | null;
}

export interface DecisionResult {
  stepOutcome: 'approved' | 'rejected' | 'pending';
  approvalsReceived?: number;
  approvalsRequired?: number;
}

/** A policy acknowledgment request (GET /api/policies/acknowledgments/mine). */
export interface AckItem {
  id: string;
  policy_id: string;
  policy_ref: string | null;
  policy_title: string;
  policy_summary: string | null;
  version: number;
  effective_on: string | null;
  requested_at: string;
  due_on: string;
  acknowledged_at: string | null;
  /** The language the person read when they acknowledged (E41-07). */
  acknowledged_language?: string | null;
  state: 'acknowledged' | 'overdue' | 'outstanding' | 'superseded';
  days_left: number;
}

export interface AckDetail extends AckItem {
  change_summary: string | null;
  body_html: string;
  /** The language of the text given: a translation's or the original's (E41-07). */
  language?: string;
  original_language?: string;
  translations?: string[];
}
