import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Asset condition (state of good repair) fields on inventory records (wave 11 contract C2, owned
 * by the condition work). They are spread into the `asset` and `site` definitions in
 * `inventory/index.ts`, so this file is the only place that adds them. Empty until the condition
 * columns exist (`inventory/migrations/005_condition_fields.sql`).
 */
export const CONDITION_ASSET_FIELDS: Record<string, FieldDef> = {};
export const CONDITION_SITE_FIELDS: Record<string, FieldDef> = {};

/** The condition lookup lists, called from inventory's `seedDefaults` (idempotent). */
export async function ensureConditionLists(ctx: ModuleContext): Promise<void> {
  void ctx;
}
