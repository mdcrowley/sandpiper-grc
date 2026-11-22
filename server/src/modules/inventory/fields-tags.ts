import { defineTaggable } from '../../core/asset-tags.ts';
import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Asset tags on inventory records (wave 13, E37-01; owned by the tags work, TAGS-CORE). Sites and
 * systems gain a Tag number (`tag_number`, column added by `inventory/migrations/007_tag_numbers.sql`),
 * spread into their definitions in `inventory/index.ts`; the asset's existing `tag` field is its tag
 * value. Core hides `tag_number` while the `tags` area is off (AREAS in core/features.ts); the
 * asset's `tag` stays, because it is also the asset's reference.
 *
 * The values are unique across every taggable type: `tag_assignments` (modules/tags) is the source
 * of truth and this field is a copy of the record's primary active value. TAGS-CORE keeps them in
 * step (see the wave 13 contracts, "Record field and assignments").
 */
export const TAG_NUMBER_FIELDS: Record<string, FieldDef> = {
  tag_number: { label: 'Tag number', type: 'text', personal: false },
};

/** Registers assets, sites and systems as taggable (called from inventory's `register`). */
export function registerInventoryTaggables(ctx: ModuleContext): void {
  defineTaggable(ctx.app, {
    type: 'asset', field: 'tag',
    identifiers: [{ field: 'serial', label: 'Serial number' }],
    siteField: 'site_id', locationField: 'location', statusField: 'status',
    peopleFields: ['user_id', 'owner_id'],
    facts: ['asset_type', 'make', 'model', 'condition_rating'],
    quickFields: ['status', 'site_id', 'location', 'user_id', 'owner_id'],
  });
  defineTaggable(ctx.app, {
    type: 'site', field: 'tag_number',
    identifiers: [],
    siteField: 'id',
    facts: ['site_kind', 'address'],
    quickFields: [],
  });
  defineTaggable(ctx.app, {
    type: 'system', field: 'tag_number',
    identifiers: [{ field: 'ref', label: 'Reference' }],
    siteField: null, statusField: 'status',
    peopleFields: ['business_owner_id', 'technical_owner_id'],
    facts: ['criticality_tier', 'system_group'],
    quickFields: ['status'],
  });
}
