// The property schedule of values (E46-64): each building, its contents, equipment or vehicle the
// property program covers (SOV-), with its location, construction, occupancy, values and when it was
// valued. The total insured value is worked out from the values. An ordinary record type, so the
// schedule is listed, filtered and exported (CSV, Excel, PDF) like any list; a summary gives the totals
// (the same for everyone) and a policy's covered sites, assets and vehicles can be added in one step.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addMonths } from '../../../../shared/dates.ts';
import { POLICY } from './policies.ts';

export const SCHEDULE_ITEM = 'insurance_schedule_item';
/** The values that add up to the total insured value. */
export const VALUE_FIELDS = ['building_value', 'contents_value', 'equipment_value', 'income_value'] as const;
/** A valuation older than this many years is counted as due for review in the summary. */
export const VALUATION_YEARS = 3;
/** Covered record types a scheduled property can name, with the column holding it. */
const RECORD_COLUMN: Record<string, string> = { site: 'site_id', asset: 'asset_id', vehicle: 'vehicle_id' };

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function registerSchedule(ctx: ModuleContext, onValues: (policyIds: (string | null | undefined)[]) => Promise<void>) {
  const { app, db } = ctx;

  function rules(existing: Row | null, patch: Row): Row {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    for (const f of [...VALUE_FIELDS, 'floor_area']) {
      const n = num(merged[f]);
      if (n !== null && (!Number.isFinite(n) || n < 0)) errors[f] = 'Enter an amount of zero or more.';
    }
    const year = num(merged.year_built);
    if (year !== null && (!Number.isInteger(year) || year < 1700 || year > Number(todayInZone().slice(0, 4)) + 5)) errors.year_built = 'Enter a four-digit year.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (!existing || VALUE_FIELDS.some((f) => f in patch)) {
      patch.total_value = round2(VALUE_FIELDS.reduce((s, f) => s + (num(merged[f]) ?? 0), 0));
    }
    return patch;
  }

  ctx.defineResource({
    type: SCHEDULE_ITEM, table: 'insurance_schedule_items', module: 'insurance', label: 'Scheduled property', plural: 'Schedule of values',
    path: '/api/insurance/schedule', route: '/insurance/schedule', titleField: 'title',
    ref: { field: 'ref', prefix: 'SOV-' },
    scope: { department: 'department_id' },
    evidence: true,
    searchable: ['title', 'location', 'occupancy', 'construction', 'notes'],
    defaultSort: { field: 'total_value', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Property', type: 'text', required: true, personal: false, help: 'What is insured, for example "North depot maintenance building" or "Bus wash equipment".' },
      policy_id: { label: 'Policy', type: 'ref', to: POLICY, help: 'The property policy the item is scheduled on.' },
      site_id: { label: 'Site', type: 'ref', to: 'site', help: 'The site record, when the property is a building or stands at a site.' },
      asset_id: { label: 'Asset', type: 'ref', to: 'asset', help: 'The asset record, for equipment.' },
      vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle', help: 'The vehicle record, for a vehicle on the schedule.' },
      department_id: { label: 'Department', type: 'ref', to: 'department', help: 'The department the property belongs to; used to split the premium by insured value.' },
      location: { label: 'Address or location', type: 'text', personal: false },
      occupancy: { label: 'Occupancy or use', type: 'text', personal: false, help: 'For example "Maintenance garage", "Offices", "Passenger station".' },
      construction: { label: 'Construction', type: 'text', personal: false, help: 'For example "Masonry, steel roof" or "Fire resistive".' },
      year_built: { label: 'Year built', type: 'number' },
      floor_area: { label: 'Floor area', type: 'number', help: 'In the unit your schedule uses (square feet or square meters).' },
      building_value: { label: 'Building value', type: 'currency' },
      contents_value: { label: 'Contents value', type: 'currency' },
      equipment_value: { label: 'Equipment value', type: 'currency' },
      income_value: { label: 'Business income value', type: 'currency', help: 'Income or extra expense insured for the time the property is out of use.' },
      total_value: { label: 'Total insured value', type: 'currency', readOnly: true, help: 'Worked out: the sum of the values.' },
      valuation_basis: { label: 'Valuation basis', type: 'lookup', list: 'insurance_valuation_basis' },
      valued_on: { label: 'Valued on', type: 'date', help: 'The day the values were last set or appraised.' },
      notes: { label: 'Notes', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (_req, data) => rules(null, data),
      beforeUpdate: (_req, existing, patch) => rules(existing, patch),
      afterCreate: async (_req, row) => { await onValues([row.policy_id]); },
      afterUpdate: async (_req, before, after) => { await onValues([before.policy_id, after.policy_id]); },
    },
  });

  ctx.resources.onChange?.(async (change) => {
    if (change.def.type !== SCHEDULE_ITEM || (change.action !== 'delete' && change.action !== 'purge')) return;
    await onValues([change.row.policy_id]);
  });

  // ---------- the schedule's totals: every item counts, so they are the same for everyone ----------

  app.get('/api/insurance/schedule/summary', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => {
    const q = req.query as Row;
    const policy = UUID_RE.test(String(q.policy_id ?? '')) ? String(q.policy_id) : null;
    const staleBefore = addMonths(todayInZone(), -12 * VALUATION_YEARS);
    const r = (await db.one<Row>(
      `select count(*)::int as items, coalesce(sum(total_value), 0)::float8 as total_value,
              coalesce(sum(building_value), 0)::float8 as building_value, coalesce(sum(contents_value), 0)::float8 as contents_value,
              coalesce(sum(equipment_value), 0)::float8 as equipment_value, coalesce(sum(income_value), 0)::float8 as income_value,
              count(*) filter (where valued_on is null or valued_on < $2::date)::int as valuation_due
       from insurance_schedule_items where deleted_at is null and ($1::uuid is null or policy_id = $1::uuid)`, [policy, staleBefore]))!;
    return {
      items: r.items, total_value: Number(r.total_value), building_value: Number(r.building_value), contents_value: Number(r.contents_value),
      equipment_value: Number(r.equipment_value), income_value: Number(r.income_value), valuation_due: r.valuation_due,
      valuation_years: VALUATION_YEARS, stale_before: staleBefore,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/schedule/summary', tag: 'Insurance', permission: 'insurance.view',
    summary: 'Totals of the property schedule of values (the same for every viewer), for every policy or one',
    query: { policy_id: 'Only the items of this policy' },
    response: '{ items, total_value, building_value, contents_value, equipment_value, income_value, valuation_due, valuation_years, stale_before }',
  });

  // ---------- a policy's covered sites, assets and vehicles onto the schedule ----------

  app.post('/api/insurance/policies/:id/schedule/from-covered', { preHandler: ctx.requirePerm('insurance.create') }, async (req: FastifyRequest, reply) => {
    const id = String((req.params as Row).id);
    const p = UUID_RE.test(id) ? await ctx.resources.find(POLICY, id, req.user) : undefined;
    if (!p) return ctx.fail(404, 'not_found', 'Policy not found.');
    const covered = await db.query<Row>(
      `select record_type, record_id, note from insurance_covered where policy_id = $1 and record_type = any($2::text[]) order by created_at`,
      [p.id, Object.keys(RECORD_COLUMN)]);
    let added = 0;
    let skipped = 0;
    for (const c of covered) {
      const col = RECORD_COLUMN[c.record_type];
      const def = ctx.resources.get(c.record_type);
      const rec = def ? await ctx.resources.find(c.record_type, c.record_id, req.user) : undefined;
      if (!def || !rec) { skipped++; continue; }
      if (await db.one(`select 1 from insurance_schedule_items where policy_id = $1 and ${col} = $2 and deleted_at is null`, [p.id, c.record_id])) { skipped++; continue; }
      await ctx.resources.create(SCHEDULE_ITEM, {
        title: String(rec[def.titleField] ?? def.label).slice(0, 200), policy_id: p.id, [col]: c.record_id,
        department_id: rec.department_id ?? null, location: rec.address ?? null, notes: c.note ?? null,
      }, req);
      added++;
    }
    reply.code(201);
    return { added, skipped };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/policies/:id/schedule/from-covered', tag: 'Insurance', permission: 'insurance.create',
    summary: 'Add the records a policy covers to the schedule of values (those already on it, or that the caller cannot open, are skipped); their values are then filled in',
    response: '{ added, skipped }',
  });
}
