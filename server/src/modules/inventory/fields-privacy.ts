import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Personal-data fields on data categories (wave 11 contract C2, owned by the records and privacy
 * work). They are spread into the `data_category` definition in `inventory/index.ts`, so this
 * file is the only place that adds them. Empty until the columns exist
 * (`inventory/migrations/006_personal_data_categories.sql`).
 */
export const PRIVACY_DATA_CATEGORY_FIELDS: Record<string, FieldDef> = {};

/** The privacy lookup lists, called from inventory's `seedDefaults` (idempotent). */
export async function ensurePrivacyLists(ctx: ModuleContext): Promise<void> {
  void ctx;
}
