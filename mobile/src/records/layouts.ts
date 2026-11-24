// Phone layouts per record type (spec §5.3 "Record view", §5.4): which fields form the summary, the key
// fields below it, and the fields the phone edit form offers. Fields a type does not have (for
// example condition fields while Asset condition is off) are skipped. Owner: APP-WORK.
import type { FieldMeta, ResourceMeta } from './types';

export interface PhoneLayout {
  /** Shown as chips and short lines under the title. */
  summary: string[];
  /** Shown as label and value rows. */
  key: string[];
  /** Offered on the phone edit form (with every field marked `mobileEditable`). */
  editable: string[];
}

export const LAYOUTS: Record<string, PhoneLayout> = {
  asset: {
    summary: ['status', 'asset_type', 'site_id', 'location'],
    key: ['tag', 'serial', 'model_id', 'make', 'model', 'user_id', 'owner_id', 'condition_rating', 'system_id', 'notes'],
    editable: ['status', 'site_id', 'location', 'user_id', 'condition_rating', 'tag', 'notes'],
  },
  vehicle: {
    summary: ['status', 'mode', 'depot_id'],
    key: ['fleet_number', 'registration', 'tag_number', 'model_id', 'make', 'model', 'model_year', 'odometer_miles', 'condition_rating', 'notes'],
    editable: ['status', 'depot_id', 'tag_number', 'odometer_miles', 'condition_rating', 'notes'],
  },
  site: {
    summary: ['site_kind', 'address'],
    key: ['tag_number', 'function', 'condition_rating', 'notes'],
    editable: ['tag_number', 'condition_rating', 'notes'],
  },
  system: {
    summary: ['status', 'criticality_tier', 'system_group'],
    key: ['ref', 'tag_number', 'business_owner_id', 'technical_owner_id', 'hosting_type', 'function', 'notes'],
    editable: ['status', 'tag_number', 'notes'],
  },
  ticket: {
    summary: ['status', 'priority', 'assignee_id', 'resolve_due_at'],
    key: ['type', 'category', 'asset_id', 'system_id', 'requester_name', 'opened_at', 'description', 'resolution_notes'],
    editable: ['status', 'assignee_id', 'resolution_notes'],
  },
  action: {
    summary: ['status', 'priority', 'owner_id', 'due_on'],
    key: ['description', 'source', 'department', 'completed_on', 'notes'],
    editable: ['status', 'owner_id', 'notes'],
  },
  safety_event: {
    summary: ['status', 'event_type', 'severity', 'occurred_at'],
    key: ['site_id', 'vehicle_id', 'location_detail', 'description', 'immediate_actions', 'investigator_id', 'investigation_due', 'notes'],
    editable: ['status', 'location_detail', 'notes'],
  },
  hazard: {
    summary: ['status', 'rating', 'owner_id', 'review_date'],
    key: ['description', 'source', 'site_id', 'consequence', 'existing_controls', 'residual_rating', 'notes'],
    editable: ['status', 'site_id', 'notes'],
  },
  inspection: {
    summary: ['status', 'due_on', 'inspector_id', 'result'],
    key: ['template_id', 'target_label', 'performed_on', 'score_pct', 'notes'],
    editable: ['inspector_id', 'notes'],
  },
};

/** The record types with their own phone layout (the others get the general one). */
export const PHONE_TYPES = Object.keys(LAYOUTS);

const SUMMARY_GUESS = ['status', 'stage', 'priority', 'severity', 'owner_id', 'assignee_id', 'due_on', 'due_at'];

/** The layout for a type, keeping only fields it has. Unknown types get a general layout. */
export function layoutFor(meta: ResourceMeta): PhoneLayout {
  const has = (f: string) => Boolean(meta.fields[f]);
  const own = LAYOUTS[meta.type];
  if (own) return { summary: own.summary.filter(has), key: own.key.filter(has), editable: own.editable.filter(has) };
  const summary = SUMMARY_GUESS.filter(has).slice(0, 4);
  const key = Object.entries(meta.fields)
    .filter(([name, f]) => name !== meta.titleField && !summary.includes(name) && f.type !== 'json' && !f.custom)
    .slice(0, 10)
    .map(([name]) => name);
  return { summary, key, editable: [] };
}

/** Fields the phone form offers: the layout's set and every `mobileEditable` field, never read-only or JSON. */
export function editableFields(meta: ResourceMeta): [string, FieldMeta][] {
  const wanted = new Set([...layoutFor(meta).editable, ...Object.entries(meta.fields).filter(([, f]) => f.mobileEditable).map(([n]) => n)]);
  const managed = meta.lifecycle?.managed ? meta.lifecycle.field : null;
  return [...wanted]
    .map((name) => [name, meta.fields[name]] as [string, FieldMeta | undefined])
    .filter((e): e is [string, FieldMeta] => Boolean(e[1]) && !e[1]!.readOnly && e[1]!.type !== 'json' && !e[1]!.multiple && e[0] !== managed);
}

/** Whether this row is restricted (whole type restricted, or the row's flag set). */
export function isRestricted(meta: ResourceMeta, row: Record<string, unknown> | null | undefined): boolean {
  if (meta.restricted === true) return true;
  return meta.restricted === 'flag' && row?.restricted === true;
}
