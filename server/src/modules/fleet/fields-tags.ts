import { defineTaggable } from '../../core/asset-tags.ts';
import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Asset tags on vehicles (wave 13, E37-01; owned by the tags work, TAGS-CORE). Vehicles gain a Tag
 * number (`tag_number`, column added by `fleet/migrations/003_tag_number.sql`), spread into the
 * vehicle definition in `fleet/index.ts`. Core hides it while the `tags` area is off. Values are
 * unique across every taggable type (see `inventory/fields-tags.ts`).
 */
export const VEHICLE_TAG_FIELDS: Record<string, FieldDef> = {
  tag_number: { label: 'Tag number', type: 'text', personal: false },
};

/** Registers vehicles as taggable (called from fleet's `register`). */
export function registerFleetTaggables(ctx: ModuleContext): void {
  defineTaggable(ctx.app, {
    type: 'vehicle', field: 'tag_number',
    identifiers: [{ field: 'fleet_number', label: 'Fleet number' }, { field: 'registration', label: 'Registration or vehicle number' }],
    siteField: 'depot_id', statusField: 'status',
    facts: ['fleet_number', 'mode', 'odometer_miles'],
    quickFields: ['status', 'depot_id'],
  });
}
