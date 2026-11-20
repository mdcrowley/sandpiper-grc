// Field names a record type has. Kept apart from FieldValue.tsx (which draws values) so it can be
// used and tested without a browser.
import type { FieldMeta, ResourceMeta } from './meta';

/** The standard columns every record type has. */
export const SYSTEM_FIELDS: Record<string, FieldMeta> = {
  created_at: { label: 'Created', type: 'datetime', readOnly: true },
  updated_at: { label: 'Updated', type: 'datetime', readOnly: true },
  created_by: { label: 'Created by', type: 'user', readOnly: true },
  updated_by: { label: 'Updated by', type: 'user', readOnly: true },
};

/**
 * The named fields the record type actually has: its own (from /api/meta) and the standard columns.
 * A field of an option that is switched off (Administration > Features) is not in the metadata, so
 * every generic list, form and summary leaves it out without the page having to know (E18-48).
 */
export function knownFields(resource: ResourceMeta | undefined | null, names: string[]): string[] {
  if (!resource) return names;
  return names.filter((f) => f in resource.fields || f in SYSTEM_FIELDS);
}
