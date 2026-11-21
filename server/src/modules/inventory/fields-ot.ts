import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * OT and rail-systems security fields on inventory records (wave 11 contract C2, owned by the OT
 * work). They are spread into the `system` and `asset` definitions in `inventory/index.ts`, so
 * this file is the only place that adds them. Empty until the OT columns exist
 * (`inventory/migrations/004_ot_fields.sql`).
 */
export const OT_SYSTEM_FIELDS: Record<string, FieldDef> = {};
export const OT_ASSET_FIELDS: Record<string, FieldDef> = {};

/** The OT lookup lists, called from inventory's `seedDefaults` (idempotent). */
export async function ensureOtLists(ctx: ModuleContext): Promise<void> {
  void ctx;
}
