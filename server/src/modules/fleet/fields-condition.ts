import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Asset condition (state of good repair) fields on vehicles (wave 11 contract C2). They are spread
 * into the `vehicle` definition in `fleet/index.ts`. Empty until the condition columns exist
 * (`fleet/migrations/002_condition.sql`).
 */
export const CONDITION_VEHICLE_FIELDS: Record<string, FieldDef> = {};

/** Fleet lists for condition, called from fleet's `seedDefaults` (idempotent). */
export async function ensureFleetConditionLists(ctx: ModuleContext): Promise<void> {
  void ctx;
}
