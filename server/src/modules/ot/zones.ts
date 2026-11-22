import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Security zones and conduits (E33-02), both in the `systems` permission module.
 *
 * Restriction: a zone carries its own `restricted` flag, which only people holding `security.view`
 * may set or clear (anyone else could hide a zone from themselves). A conduit joins two zones, so it
 * cannot inherit through `restrictedFrom` (one source record only). Instead its flag is read-only and
 * set by the application: true when either zone is restricted, worked out when the conduit is saved
 * and again whenever a zone's flag changes (`syncConduits`, through the resource engine, so actions
 * raised on a conduit follow too). A person must see both zones to point a conduit at them.
 *
 * Systems and assets: a person may only put a record in a zone they can see. Core checks only that a
 * `ref` field holds an id, so this module wraps the inventory types' hooks (`guardZoneRefs`).
 */

const SECURITY_VIEW = 'security.view';

export function registerZones(ctx: ModuleContext) {
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  /** Only people who may see restricted records may change a zone's restriction. */
  function checkRestriction(req: FastifyRequest | null, existing: Row | null, patch: Row) {
    if (!req || !('restricted' in patch)) return;
    const was = existing ? existing.restricted === true : false;
    if ((patch.restricted === true) !== was && !ctx.can(req.user, SECURITY_VIEW)) {
      ctx.fail(403, 'forbidden', 'Only people who may see restricted records can restrict a zone or lift its restriction.');
    }
  }

  function stampAssessment(existing: Row | null, patch: Row) {
    if ('achieved_level' in patch && patch.achieved_level !== (existing?.achieved_level ?? null) && !('level_assessed_on' in patch)) {
      patch.level_assessed_on = patch.achieved_level ? dayInZone() : null;
    }
  }

  ctx.defineResource({
    type: 'ot_zone', table: 'ot_zones', module: 'systems', label: 'Security zone', plural: 'Security zones',
    path: '/api/ot-zones', route: '/ot/zones', titleField: 'name',
    ref: { field: 'ref', prefix: 'ZON-' },
    restricted: 'flag',
    searchable: ['name', 'description', 'notes'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'What it holds', type: 'longtext', personal: false },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      owner_id: { label: 'Owner', type: 'user' },
      criticality: { label: 'Criticality', type: 'lookup', list: 'criticality_tier' },
      target_level: { label: 'Target security level', type: 'lookup', list: 'ot_security_level' },
      achieved_level: { label: 'Achieved security level', type: 'lookup', list: 'ot_security_level' },
      level_assessed_on: { label: 'Level assessed on', type: 'date' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
      restricted: { label: 'Restricted', type: 'boolean', default: false },
    },
    hooks: {
      beforeCreate: (req, data) => {
        checkRestriction(req, null, data);
        stampAssessment(null, data);
        return data;
      },
      beforeUpdate: (req, existing, patch) => {
        checkRestriction(req, existing, patch);
        stampAssessment(existing, patch);
        return patch;
      },
      afterUpdate: async (_req, before, after) => {
        if ((before.restricted === true) !== (after.restricted === true)) await syncConduits(ctx, after.id);
      },
    },
  });

  /** Both zones of a conduit, checked: they exist, they differ, and the person can see them. */
  async function checkConduit(req: FastifyRequest | null, merged: Row, patch: Row): Promise<Row> {
    const errors: Record<string, string> = {};
    const zones: Row[] = [];
    for (const f of ['from_zone_id', 'to_zone_id']) {
      const id = merged[f];
      if (!id) { errors[f] = 'Choose a zone.'; continue; }
      const zone = await ctx.resources.find('ot_zone', String(id), req ? req.user : null);
      if (!zone) errors[f] = 'Zone not found.';
      else zones.push(zone);
    }
    if (!errors.to_zone_id && merged.from_zone_id && merged.from_zone_id === merged.to_zone_id) errors.to_zone_id = 'A conduit joins two different zones.';
    if (Object.keys(errors).length) invalid(errors);
    // The flag is worked out from the zones as stored, whoever saves.
    const stored = await ctx.db.query<Row>('select id, name, restricted from ot_zones where id = any($1::uuid[])', [[merged.from_zone_id, merged.to_zone_id]]);
    patch.restricted = stored.some((z) => z.restricted === true);
    if (!merged.name || !String(merged.name).trim()) {
      const name = (id: string) => stored.find((z) => z.id === id)?.name ?? 'zone';
      patch.name = `${name(merged.from_zone_id)} to ${name(merged.to_zone_id)}`;
    }
    void zones;
    return patch;
  }

  ctx.defineResource({
    type: 'ot_conduit', table: 'ot_conduits', module: 'systems', label: 'Conduit', plural: 'Conduits',
    path: '/api/ot-conduits', route: '/ot/conduits', titleField: 'name',
    ref: { field: 'ref', prefix: 'CDT-' },
    restricted: 'flag',
    searchable: ['name', 'protocols', 'protections', 'notes'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text' },
      from_zone_id: { label: 'From zone', type: 'ref', to: 'ot_zone', required: true },
      to_zone_id: { label: 'To zone', type: 'ref', to: 'ot_zone', required: true },
      protocols: { label: 'Protocols', type: 'text', personal: false },
      protections: { label: 'Protections', type: 'longtext', personal: false },
      remote_access: { label: 'Remote access', type: 'boolean', default: false },
      target_level: { label: 'Target security level', type: 'lookup', list: 'ot_security_level' },
      achieved_level: { label: 'Achieved security level', type: 'lookup', list: 'ot_security_level' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
      restricted: { label: 'Restricted (follows its zones)', type: 'boolean', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => checkConduit(req, data, data),
      beforeUpdate: (req, existing, patch) => checkConduit(req, { ...existing, ...patch }, patch),
    },
  });

  // A deleted zone leaves no system or asset pointing at it.
  ctx.resources.onChange?.(async (change) => {
    if (change.def.type !== 'ot_zone' || (change.action !== 'delete' && change.action !== 'purge')) return;
    for (const type of ['system', 'asset']) {
      const def = ctx.resources.get(type);
      if (!def?.fields.zone_id) continue;
      const rows = await ctx.db.query<{ id: string }>(`select id from ${def.table} where zone_id = $1 and deleted_at is null`, [change.row.id]);
      for (const r of rows) await ctx.resources.update(type, r.id, { zone_id: null }, null);
    }
  });
}

/** Brings the flag of every conduit touching `zoneId` in line with its two zones (system work). */
export async function syncConduits(ctx: ModuleContext, zoneId: string): Promise<number> {
  const rows = await ctx.db.query<{ id: string; flag: boolean }>(
    `select c.id, (coalesce(f.restricted, false) or coalesce(t.restricted, false)) as flag
     from ot_conduits c left join ot_zones f on f.id = c.from_zone_id left join ot_zones t on t.id = c.to_zone_id
     where (c.from_zone_id = $1 or c.to_zone_id = $1) and c.deleted_at is null
       and coalesce(c.restricted, false) <> (coalesce(f.restricted, false) or coalesce(t.restricted, false))`,
    [zoneId],
  );
  for (const r of rows) await ctx.resources.update('ot_conduit', r.id, { restricted: r.flag }, null);
  return rows.length;
}

/**
 * Wraps the `system` and `asset` hooks so a person can only put a record in a zone they can see
 * (system work, such as seeding, is not checked). Inventory registers before this module, so both
 * definitions exist here; an inventory without the OT fields is left alone.
 */
export function guardZoneRefs(ctx: ModuleContext) {
  for (const type of ['system', 'asset']) {
    const def: ResourceDef | undefined = ctx.resources.get(type);
    if (!def?.fields.zone_id) continue;
    const own = def.hooks ?? {};
    const check = async (req: FastifyRequest | null, patch: Row) => {
      if (!req || !patch.zone_id) return;
      const zone = await ctx.resources.find('ot_zone', String(patch.zone_id), req.user);
      if (!zone) ctx.fail(400, 'validation', 'Check the highlighted fields.', { zone_id: 'Security zone not found.' });
    };
    def.hooks = {
      ...own,
      beforeCreate: async (req, data) => {
        const out = own.beforeCreate ? await own.beforeCreate(req, data) : data;
        await check(req, out);
        return out;
      },
      beforeUpdate: async (req, existing, patch) => {
        const out = own.beforeUpdate ? await own.beforeUpdate(req, existing, patch) : patch;
        if ('zone_id' in out && out.zone_id !== existing.zone_id) await check(req, out);
        return out;
      },
    };
  }
}
