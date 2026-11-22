import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Personal-data fields on data categories (wave 11 contract C2, owned by the records and privacy
 * work, E34-05). They are spread into the `data_category` definition in `inventory/index.ts`, so this
 * file is the only place that adds them. Columns: `inventory/migrations/006_personal_data_categories.sql`.
 * The `records` area lists them in `fields`, so they are hidden while records and privacy is off.
 * A system holding a category with `personal_data` is expected to have a privacy impact assessment.
 */
export const PRIVACY_DATA_CATEGORY_FIELDS: Record<string, FieldDef> = {
  personal_data: { label: 'Holds personal data', type: 'boolean', default: false },
  personal_data_kinds: { label: 'Kinds of personal data', type: 'lookup', list: 'personal_data_kind', multiple: true },
};

/** The privacy lookup lists, called from inventory's `seedDefaults` (idempotent). */
export async function ensurePrivacyLists(ctx: ModuleContext): Promise<void> {
  // Owned by the privacy permission module: hidden with the records area while it is switched off.
  await ctx.lookups.ensure('personal_data_kind', [
    { value: 'contact', label: 'Contact details', sort: 10 },
    { value: 'identity_documents', label: 'Identity documents', sort: 20 },
    { value: 'account_payment', label: 'Account and payment', sort: 30 },
    { value: 'travel_location', label: 'Travel history and location', sort: 40 },
    { value: 'video_images', label: 'Video images', sort: 50 },
    { value: 'health_eligibility', label: 'Health or eligibility', sort: 60 },
    { value: 'employment', label: 'Employment', sort: 70 },
    { value: 'other', label: 'Other', sort: 90 },
  ], { module: 'privacy' });
}
