import type { FieldDef, ModuleContext } from '../../core/module.ts';

/**
 * OT and rail-systems security fields on inventory records (E33-01, wave 11 contract C2, owned by
 * the OT work). They are spread into the `system` and `asset` definitions in `inventory/index.ts`,
 * so this file is the only place that adds them; the columns come from
 * `inventory/migrations/004_ot_fields.sql`. While the `ot` area is switched off core hides every one
 * of them (AREAS `fields`), and `zone_id` also disappears with the `ot_zone` type. The `ot` module
 * checks that a person can see the zone they set (`ot/zones.ts`).
 */
export const OT_SYSTEM_FIELDS: Record<string, FieldDef> = {
  ot_system: { label: 'Operational technology (OT)', type: 'boolean', default: false },
  control_level: { label: 'Control level', type: 'lookup', list: 'ot_control_level' },
  safety_related: { label: 'Life-critical', type: 'boolean', default: false },
  vendor_remote_access: { label: 'Supplier remote access', type: 'lookup', list: 'vendor_remote_access' },
  remote_access_path: { label: 'Remote access path', type: 'text', personal: false },
  patchability: { label: 'Patching', type: 'lookup', list: 'ot_patchability' },
  field_location: { label: 'Field location', type: 'text', personal: false },
  zone_id: { label: 'Security zone', type: 'ref', to: 'ot_zone' },
};

export const OT_ASSET_FIELDS: Record<string, FieldDef> = {
  ot_asset: { label: 'Operational technology (OT)', type: 'boolean', default: false },
  control_level: { label: 'Control level', type: 'lookup', list: 'ot_control_level' },
  safety_related: { label: 'Life-critical', type: 'boolean', default: false },
  firmware_version: { label: 'Firmware version', type: 'text', personal: false },
  zone_id: { label: 'Security zone', type: 'ref', to: 'ot_zone' },
};

/**
 * The OT lookup lists, called from inventory's `seedDefaults` (idempotent; administrators may rename
 * and recolor every value under Administration > Lists). The meanings the code reads are in `meta`:
 * - `ot_control_level`: `meta.level` orders the levels, from field devices (0) up to business systems (4).
 * - `vendor_remote_access`: `meta.none` = the vendor has no remote access (no offboarding item is needed),
 *   `meta.standing` = the access is always there.
 * - `ot_patchability`: `meta.unpatchable` = counted as "cannot be patched" on the OT overview.
 */
export async function ensureOtLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'systems' };
  await ctx.lookups.ensure('ot_control_level', [
    { value: 'level_0', label: '0 Field devices', color: 'gray', sort: 10, meta: { level: 0 } },
    { value: 'level_1', label: '1 Basic control', color: 'blue', sort: 20, meta: { level: 1 } },
    { value: 'level_2', label: '2 Supervisory control', color: 'teal', sort: 30, meta: { level: 2 } },
    { value: 'level_3', label: '3 Site operations', color: 'purple', sort: 40, meta: { level: 3 } },
    { value: 'level_4', label: '4 Business systems', color: 'amber', sort: 50, meta: { level: 4 } },
  ], own);
  await ctx.lookups.ensure('vendor_remote_access', [
    { value: 'none', label: 'None', color: 'green', sort: 10, meta: { none: true } },
    { value: 'supervised', label: 'Supervised session on request', color: 'blue', sort: 20 },
    { value: 'managed_gateway', label: 'On demand through a managed gateway', color: 'teal', sort: 30 },
    { value: 'always_connected', label: 'Always connected', color: 'red', sort: 40, meta: { standing: true } },
    { value: 'not_known', label: 'Not known', color: 'gray', sort: 50 },
  ], own);
  await ctx.lookups.ensure('ot_patchability', [
    { value: 'routine', label: 'Patched routinely', color: 'green', sort: 10 },
    { value: 'vendor_approved', label: 'Supplier-approved patches only', color: 'blue', sort: 20 },
    { value: 'outage_only', label: 'Patched only during outages', color: 'amber', sort: 30 },
    { value: 'cannot_patch', label: 'Cannot be patched', color: 'red', sort: 40, meta: { unpatchable: true } },
    { value: 'not_known', label: 'Not known', color: 'gray', sort: 50 },
  ], own);
}
