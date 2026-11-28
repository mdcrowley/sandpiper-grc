import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { seedMaintenance } from '../fleet/seed-maintenance.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Dev profile only: a few invented vehicle models (with equipment) and asset models, given to the
 * sample fleet's vehicles and their equipment (E39-07). Runs after the fleet and inventory samples
 * (modules seed in name order). Safe to run again: models are matched by name, and only members with
 * no model yet are assigned. Every name starts with "[Sample]".
 */

interface ModelSeed { name: string; fields: Row; members?: (row: Row) => boolean; equipment?: { asset_type: string; count: number; asset_model?: string }[] }

const ASSET_MODELS: (ModelSeed & { match: { asset_type: string; make: string; model: string } })[] = [
  {
    name: '[Sample] Clearsight MVR4 camera recorder', match: { asset_type: 'camera', make: 'Clearsight', model: 'MVR4' },
    fields: { asset_type: 'camera', make: 'Clearsight', model: 'MVR4', funding_source: 'grant', description: '[Sample] Four-channel recorder fitted to every bus and tram.' },
  },
  {
    name: '[Sample] Coinway V-Tap card validator', match: { asset_type: 'validator', make: 'Coinway', model: 'V-Tap' },
    fields: { asset_type: 'validator', make: 'Coinway', model: 'V-Tap', funding_source: 'mixed', support_end: dayInZone(900), description: '[Sample] Contactless card validator at each door.' },
  },
  {
    name: '[Sample] Talkwave MR-40 radio', match: { asset_type: 'radio', make: 'Talkwave', model: 'MR-40' },
    fields: { asset_type: 'radio', make: 'Talkwave', model: 'MR-40', funding_source: 'capital', description: '[Sample] Mobile radio for voice dispatch.' },
  },
];

const num = (r: Row) => Number(r.fleet_number);

const VEHICLE_MODELS: ModelSeed[] = [
  {
    name: '[Sample] Citystrider 12 diesel bus',
    fields: { mode: 'bus', make: 'Example Coachworks', model: 'Citystrider 12', capacity: 78, funding_source: 'capital', description: '[Sample] The older 12-meter buses, bought from the capital budget.' },
    members: (r) => r.mode === 'bus' && num(r) >= 1201 && num(r) <= 1216,
  },
  {
    name: '[Sample] Citystrider 12E electric bus',
    fields: { mode: 'bus', make: 'Example Coachworks', model: 'Citystrider 12E', capacity: 82, funding_source: 'grant', description: '[Sample] Battery-electric buses from the grant-funded order. Each carries the standard camera recorder.' },
    members: (r) => r.mode === 'bus' && num(r) >= 1217 && num(r) <= 1238,
    equipment: [{ asset_type: 'camera', count: 1, asset_model: '[Sample] Clearsight MVR4 camera recorder' }],
  },
  {
    name: '[Sample] Citystrider 12E, two cameras',
    fields: { mode: 'bus', make: 'Example Coachworks', model: 'Citystrider 12E', capacity: 82, funding_source: 'grant', description: '[Sample] Electric buses on the night routes, which need a second camera recorder.' },
    members: (r) => r.mode === 'bus' && num(r) >= 1239 && num(r) <= 1240,
    equipment: [{ asset_type: 'camera', count: 2 }, { asset_type: 'passenger_info_display', count: 1 }],
  },
  {
    name: '[Sample] LRV-30 light-rail vehicle',
    fields: { mode: 'light_rail', make: 'Example Railcar Works', model: 'LRV-30', model_year: 2014, capacity: 210, funding_source: 'grant', description: '[Sample] The light-rail fleet.' },
    members: (r) => r.mode === 'light_rail',
  },
  {
    name: '[Sample] Citystrider 10 (no longer ordered)',
    fields: { mode: 'bus', make: 'Example Coachworks', model: 'Citystrider 10', capacity: 60, funding_source: 'capital', active: false, description: '[Sample] An inactive model: kept for the record, not offered for new vehicles.' },
  },
];

async function upsertModel(ctx: ModuleContext, type: string, table: string, s: ModelSeed): Promise<{ row: Row; made: boolean }> {
  const found = await ctx.db.one<Row>(`select * from ${table} where lower(name) = lower($1) and deleted_at is null`, [s.name]);
  if (found) return { row: found, made: false };
  return { row: await ctx.resources.create(type, { name: s.name, ...s.fields }), made: true };
}

export async function seedModels(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing for this profile';
  const parts: string[] = [];
  const assetModels = new Map<string, string>();
  if (ctx.resources.get('asset_model')) {
    let made = 0;
    let given = 0;
    for (const s of ASSET_MODELS) {
      const { row, made: isNew } = await upsertModel(ctx, 'asset_model', 'asset_models', s);
      assetModels.set(s.name, row.id);
      if (isNew) made++;
      const members = await ctx.db.query<{ id: string }>(
        `select id from assets where deleted_at is null and model_id is null and asset_type = $1 and make = $2 and model = $3 and name like '[Sample]%'`,
        [s.match.asset_type, s.match.make, s.match.model]);
      for (const m of members) { await ctx.resources.update('asset', m.id, { model_id: row.id }); given++; }
    }
    parts.push(`asset models ${ASSET_MODELS.length} (${made} new), ${given} assets given a model`);
  }
  if (ctx.resources.get('vehicle_model')) {
    let made = 0;
    let given = 0;
    const vehicles = await ctx.db.query<Row>('select id, fleet_number, mode, model_id from vehicles where deleted_at is null');
    for (const s of VEHICLE_MODELS) {
      const { row, made: isNew } = await upsertModel(ctx, 'vehicle_model', 'vehicle_models', s);
      if (isNew) {
        made++;
        for (const [i, e] of (s.equipment ?? []).entries()) {
          await ctx.db.query('insert into vehicle_model_equipment (vehicle_model_id, asset_type, count, asset_model_id, position) values ($1,$2,$3,$4,$5)',
            [row.id, e.asset_type, e.count, e.asset_model ? assetModels.get(e.asset_model) ?? null : null, i]);
        }
      }
      for (const v of vehicles.filter((r) => !r.model_id && s.members?.(r))) {
        await ctx.resources.update('vehicle', v.id, { model_id: row.id });
        given++;
      }
    }
    // One override: bus 1205 had seats taken out for a wheelchair bay, so it keeps its own capacity.
    const bus = await ctx.db.one<Row>(`select id, model_overrides from vehicles where fleet_number = '1205' and deleted_at is null and model_id is not null`);
    if (bus && !(bus.model_overrides ?? []).includes('capacity')) await ctx.resources.update('vehicle', bus.id, { capacity: 72 });
    parts.push(`vehicle models ${VEHICLE_MODELS.length} (${made} new), ${given} vehicles given a model`);
    // Wave 27 (E46-71): planned maintenance intervals for these models, with readings and services (fleet module).
    const maintenance = await seedMaintenance(ctx);
    if (maintenance) parts.push(maintenance);
  }
  return parts.join('; ') || 'skipped: fleet and inventory are not loaded';
}
