import type { FieldDef, ModuleContext } from '../../core/module.ts';
import { CONDITION_COMMON_FIELDS, ensureConditionRating } from '../inventory/fields-condition.ts';

/**
 * Asset condition (state of good repair) fields on vehicles (wave 11 contract C2, E32). They are
 * spread into the `vehicle` definition in `fleet/index.ts`; the columns are in
 * `fleet/migrations/002_condition.sql`. The condition module keeps the rating, its date and the
 * useful-life end up to date (read-only here); core hides them while the `condition` area is off.
 */
export const CONDITION_VEHICLE_FIELDS: Record<string, FieldDef> = {
  odometer_miles: { label: 'Odometer (miles)', type: 'number' },
  // Set when the odometer changes (modules/condition); with the in-service date it gives the rate the vehicle runs at.
  odometer_read_on: { label: 'Odometer read on', type: 'date', readOnly: true },
  ...CONDITION_COMMON_FIELDS,
};

/** Fleet lists for condition, called from fleet's `seedDefaults` (idempotent). */
export async function ensureFleetConditionLists(ctx: ModuleContext): Promise<void> {
  await ensureConditionRating(ctx);
}
