import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { belowTarget, rankOf } from './lists.ts';

/**
 * OT routes beyond the generated ones (E33-02, E33-03, E33-05):
 * - `GET /api/ot-zones/:id/members`: the systems and assets in a zone the caller may see;
 * - `GET /api/ot/matrix`: the zones and conduits the caller may see, with their levels;
 * - `GET /api/ot/summary`: figures for the overview and for assistants (contract C5), the same for
 *   everyone, counting every record and naming none;
 * - `GET /api/frameworks/starters/ot-control-structure`: the starter structure file;
 * - metric `ot.zones_below_target` (contract C6).
 */

const here = dirname(fileURLToPath(import.meta.url));
export const STARTER_FILE = join(here, '..', 'frameworks', 'starters', 'ot-control-structure.template.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The starter structure file, parsed. */
export function loadStarter(): Row {
  return JSON.parse(readFileSync(STARTER_FILE, 'utf8')) as Row;
}

async function valuesWith(ctx: ModuleContext, list: string, flag: string): Promise<string[]> {
  return (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag] === true).map((v) => v.value);
}

/** Zones below target now: every zone counts, restricted or not (a figure). */
export async function zonesBelowTarget(ctx: ModuleContext): Promise<number> {
  const rank = await rankOf(ctx);
  const zones = await ctx.db.query<Row>('select target_level, achieved_level from ot_zones where deleted_at is null');
  return zones.filter((z) => belowTarget(rank, z.target_level, z.achieved_level)).length;
}

export function registerRoutes(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = { preHandler: ctx.requirePerm('systems.view') };

  defineMetric(app, {
    key: 'ot.zones_below_target', label: 'Security zones below target', unit: 'count', recordType: 'ot_zone',
    description: 'Security zones whose achieved level is below their target, or that have not been assessed. Only the levels recorded now are known, so earlier months have no value.',
    compute: async (c, monthStart) => (monthStart === `${dayInZone().slice(0, 7)}-01` ? zonesBelowTarget(c) : null),
  });

  const zoneFor = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as Row).id);
    return (UUID_RE.test(id) ? await ctx.resources.find('ot_zone', id, req.user) : undefined) ?? ctx.fail(404, 'not_found', 'Security zone not found.');
  };

  app.get('/api/ot-zones/:id/members', view, async (req) => {
    const zone = await zoneFor(req);
    const systems = ctx.can(req.user, 'systems.view') && ctx.resources.get('system')
      ? await db.query<Row>(
        `select s.id, s.ref, s.name, s.ot_system, s.control_level, s.safety_related, s.patchability, s.vendor_remote_access, s.criticality_tier
         from systems s where s.zone_id = $1 and s.deleted_at is null and ${ctx.resources.visibleWhere('system', req.user, 's')} order by s.name`, [zone.id])
      : null;
    const assets = ctx.can(req.user, 'assets.view') && ctx.resources.get('asset')
      ? await db.query<Row>(
        `select a.id, a.tag, a.name, a.ot_asset, a.control_level, a.safety_related, a.firmware_version, a.status
         from assets a where a.zone_id = $1 and a.deleted_at is null and ${ctx.resources.visibleWhere('asset', req.user, 'a')} order by a.name`, [zone.id])
      : null;
    return { systems, assets };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/ot-zones/:id/members', permission: 'systems.view',
    summary: 'Systems and assets in one security zone',
    description: 'Only records the caller may see; `systems` or `assets` is null when the caller may not view that kind of record.',
    response: '{ systems: [{ id, ref, name, ot_system, control_level, safety_related, patchability, vendor_remote_access, criticality_tier }] | null, assets: [{ id, tag, name, ot_asset, control_level, safety_related, firmware_version, status }] | null }',
  });

  app.get('/api/ot/matrix', view, async (req) => {
    const rank = await rankOf(ctx);
    const zones = await db.query<Row>(
      `select z.id, z.ref, z.name, z.target_level, z.achieved_level, z.level_assessed_on::text as level_assessed_on, z.criticality, z.restricted,
              (select count(*)::int from systems s where s.zone_id = z.id and s.deleted_at is null) as systems,
              (select count(*)::int from assets a where a.zone_id = z.id and a.deleted_at is null) as assets
       from ot_zones z where z.deleted_at is null and ${ctx.resources.visibleWhere('ot_zone', req.user, 'z')} order by z.name`,
    );
    const below = new Set(zones.filter((z) => belowTarget(rank, z.target_level, z.achieved_level)).map((z) => z.id));
    // Every zone's state, for flagging conduits: a conduit is flagged by a zone below target even when
    // the caller cannot see that zone (it is then restricted itself, and hidden from them anyway).
    const allBelow = new Set((await db.query<Row>('select id, target_level, achieved_level from ot_zones where deleted_at is null'))
      .filter((z) => belowTarget(rank, z.target_level, z.achieved_level)).map((z) => z.id));
    const conduits = await db.query<Row>(
      `select c.id, c.ref, c.name, c.from_zone_id, c.to_zone_id, c.protocols, c.remote_access, c.target_level, c.achieved_level, c.restricted
       from ot_conduits c
       join ot_zones f on f.id = c.from_zone_id and f.deleted_at is null
       join ot_zones t on t.id = c.to_zone_id and t.deleted_at is null
       where c.deleted_at is null and ${ctx.resources.visibleWhere('ot_conduit', req.user, 'c')} order by c.ref`,
    );
    return {
      zones: zones.map((z) => ({ ...z, below_target: below.has(z.id) })),
      conduits: conduits.map((c) => ({
        ...c,
        below_target: belowTarget(rank, c.target_level, c.achieved_level) && !!c.target_level,
        flagged: c.remote_access === true || allBelow.has(c.from_zone_id) || allBelow.has(c.to_zone_id),
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/ot/matrix', permission: 'systems.view',
    summary: 'Security zones and the conduits between them, with their levels',
    description: 'Only zones and conduits the caller may see. A zone is below target when its achieved level is lower than its target or it has not been assessed; a conduit is flagged when it allows remote access or touches a zone below target.',
    response: '{ zones: [{ id, ref, name, target_level, achieved_level, level_assessed_on, criticality, restricted, systems, assets, below_target }], conduits: [{ id, ref, name, from_zone_id, to_zone_id, protocols, remote_access, target_level, achieved_level, restricted, below_target, flagged }] }',
  });

  app.get('/api/ot/summary', view, async () => {
    const rank = await rankOf(ctx);
    const unpatchable = await valuesWith(ctx, 'ot_patchability', 'unpatchable');
    const standing = await valuesWith(ctx, 'vendor_remote_access', 'standing');
    const s = (await db.one<Row>(
      `select count(*) filter (where ot_system)::int as ot_systems,
              count(*) filter (where ot_system and safety_related)::int as safety_related,
              count(*) filter (where ot_system and patchability = any($1::text[]))::int as unpatchable,
              count(*) filter (where ot_system and vendor_remote_access = any($2::text[]))::int as always_connected,
              count(*) filter (where ot_system and zone_id is null)::int as without_zone
       from systems where deleted_at is null and coalesce(status, '') <> 'retired'`, [unpatchable, standing],
    ))!;
    const levels = await db.query<Row>(
      `select coalesce(control_level, '') as value, count(*)::int as count from systems
       where deleted_at is null and ot_system and coalesce(status, '') <> 'retired' group by 1`,
    );
    const zones = await db.query<Row>('select id, target_level, achieved_level from ot_zones where deleted_at is null');
    const below = new Set(zones.filter((z) => belowTarget(rank, z.target_level, z.achieved_level)).map((z) => z.id));
    const conduits = await db.query<Row>(
      `select c.remote_access, c.from_zone_id, c.to_zone_id from ot_conduits c
       join ot_zones f on f.id = c.from_zone_id and f.deleted_at is null join ot_zones t on t.id = c.to_zone_id and t.deleted_at is null
       where c.deleted_at is null`,
    );
    const otAssets = (await db.one<Row>(`select count(*)::int as n from assets where deleted_at is null and ot_asset and coalesce(status, '') <> 'disposed'`))!.n;
    const controlLevels = await ctx.lookups.values('ot_control_level');
    return {
      ot_systems: s.ot_systems,
      ot_assets: otAssets,
      safety_related: s.safety_related,
      zones: zones.length,
      zones_below_target: below.size,
      conduits: conduits.length,
      conduits_with_remote_access: conduits.filter((c) => c.remote_access).length,
      conduits_flagged: conduits.filter((c) => c.remote_access || below.has(c.from_zone_id) || below.has(c.to_zone_id)).length,
      unpatchable: s.unpatchable,
      always_connected: s.always_connected,
      without_zone: s.without_zone,
      by_control_level: [
        ...controlLevels.map((v) => ({ value: v.value, label: v.label, color: v.color ?? 'gray', count: levels.find((l) => l.value === v.value)?.count ?? 0 })),
        { value: '', label: 'Not recorded', color: 'gray', count: levels.filter((l) => !controlLevels.some((v) => v.value === l.value)).reduce((n, l) => n + l.count, 0) },
      ],
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/ot/summary', permission: 'systems.view',
    summary: 'OT security figures: OT systems, zones below target, remote-access conduits, systems that cannot be patched',
    description: 'Counts every record, restricted zones and conduits included, the same for everyone, and names none. Retired systems and disposed assets are left out.',
    response: '{ ot_systems, ot_assets, safety_related, zones, zones_below_target, conduits, conduits_with_remote_access, conduits_flagged, unpatchable, always_connected, without_zone, by_control_level: [{ value, label, color, count }] }',
  });

  app.get('/api/frameworks/starters/ot-control-structure', { preHandler: ctx.requirePerm('frameworks.view') }, async (_req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="ot-control-structure.template.json"');
    return loadStarter();
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/frameworks/starters/ot-control-structure', permission: 'frameworks.view', tag: 'frameworks',
    summary: 'Starter structure file for an OT control catalog',
    description: 'A reference file with functions, categories and placeholder outcomes, and a mapping block to the shipped framework\'s outcome codes. It holds no standard\'s text: fill the outcomes from your own licensed copy, then load it under Frameworks and structure.',
    response: 'A reference file (JSON): { key, name, description, functions: [...], mappings: [...] }',
  });
}
