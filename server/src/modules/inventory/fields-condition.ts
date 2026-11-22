import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * Asset condition (state of good repair) fields on inventory records (wave 11 contract C2, owned
 * by the condition work, E32). They are spread into the `asset` and `site` definitions in
 * `inventory/index.ts`, so this file is the only place that adds them. The columns are in
 * `inventory/migrations/005_condition_fields.sql`. The condition module (`modules/condition`)
 * keeps the rating, the date it was assessed and the useful-life end up to date, so those are
 * read-only here; while the `condition` area is switched off core hides every one of them.
 */

/** Shared by assets, sites and vehicles (`fleet/fields-condition.ts`). */
export const CONDITION_COMMON_FIELDS: Record<string, FieldDef> = {
  asset_class_id: { label: 'Asset class', type: 'ref', to: 'asset_class' },
  condition_rating: { label: 'Condition', type: 'lookup', list: 'condition_rating', readOnly: true },
  condition_assessed_on: { label: 'Condition assessed on', type: 'date', readOnly: true },
  useful_life_end: { label: 'End of useful life', type: 'date', readOnly: true },
  replacement_project_id: { label: 'Replacement project', type: 'ref', to: 'project' },
};

export const CONDITION_ASSET_FIELDS: Record<string, FieldDef> = {
  in_service_date: { label: 'In service since', type: 'date' },
  ...CONDITION_COMMON_FIELDS,
};

export const CONDITION_SITE_FIELDS: Record<string, FieldDef> = {
  site_kind: { label: 'Kind of site', type: 'lookup', list: 'site_kind' },
  // Stored as a whole number; declared as text so it is shown as "1987", not "1,987".
  built_year: { label: 'Year built', type: 'text' },
  in_use: { label: 'In use', type: 'boolean', default: true },
  ...CONDITION_COMMON_FIELDS,
};

/** The 1 to 5 condition scale (labels may be renamed; `meta.score` is the number behind each). */
export async function ensureConditionRating(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('condition_rating', [
    { value: '5', label: '5 - Excellent', color: 'green', sort: 10, meta: { score: 5 } },
    { value: '4', label: '4 - Good', color: 'teal', sort: 20, meta: { score: 4 } },
    { value: '3', label: '3 - Adequate', color: 'blue', sort: 30, meta: { score: 3 } },
    { value: '2', label: '2 - Marginal', color: 'orange', sort: 40, meta: { score: 2 } },
    { value: '1', label: '1 - Poor', color: 'red', sort: 50, meta: { score: 1 } },
  ], { module: 'assets' });
}

/** The condition lookup lists, called from inventory's `seedDefaults` (idempotent). */
export async function ensureConditionLists(ctx: ModuleContext): Promise<void> {
  await ensureConditionRating(ctx);
  await ctx.lookups.ensure('site_kind', [
    { value: 'passenger_station', label: 'Passenger station', sort: 10 },
    { value: 'bus_stop', label: 'Bus stop or shelter', sort: 20 },
    { value: 'depot', label: 'Depot or garage', sort: 30 },
    { value: 'maintenance_facility', label: 'Maintenance facility', sort: 40 },
    { value: 'office', label: 'Office', sort: 50 },
    { value: 'guideway_section', label: 'Guideway section', sort: 60 },
    { value: 'track_segment', label: 'Track segment', sort: 70 },
    { value: 'traction_power_substation', label: 'Traction power substation', sort: 80 },
    { value: 'bridge_or_structure', label: 'Bridge or structure', sort: 90 },
    { value: 'data_center', label: 'Data center', sort: 100 },
    { value: 'other', label: 'Other', sort: 200 },
  ], { module: 'sites' });
  // Infrastructure and facility equipment, with explicit sorts so they slot in after "Subscription"
  // and before "Other" (inventory's own values).
  await ctx.lookups.ensure('asset_type', [
    { value: 'track_segment', label: 'Track segment', sort: 71 },
    { value: 'guideway_element', label: 'Guideway element', sort: 72 },
    { value: 'switch_turnout', label: 'Switch or turnout', sort: 73 },
    { value: 'traction_power_equipment', label: 'Traction power equipment', sort: 74 },
    { value: 'signal_equipment', label: 'Signal equipment', sort: 75 },
    { value: 'elevator_escalator', label: 'Elevator or escalator', sort: 76 },
    { value: 'facility_system', label: 'Facility system', sort: 77 },
  ], { module: 'assets' });
}
