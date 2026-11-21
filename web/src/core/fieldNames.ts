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

/**
 * The filters of a view (keyed like the list contract without `f.`: `status`, `due_at.gt`) on fields
 * the record type has, plus tags. A filter read from the page address or a saved view on a field the
 * type lacks, or one hidden by a switched-off option, is dropped (E18-49). Without metadata yet, every
 * filter is kept.
 */
export function knownFilters(resource: ResourceMeta | undefined | null, filters: Record<string, string[]>): Record<string, string[]> {
  if (!resource) return filters;
  return Object.fromEntries(Object.entries(filters).filter(([key]) => {
    const name = key.split('.')[0];
    return name === 'tags' || knownFields(resource, [name]).length > 0;
  }));
}
