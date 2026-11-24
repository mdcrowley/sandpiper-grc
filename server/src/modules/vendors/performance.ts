// Contractor performance reviews (E41-11): a contract carries measures, each with a target, which way
// is better (higher or lower) and how often it is scored (monthly, quarterly or yearly). A score is
// recorded for one period with a comment; the page shows whether each score met the target and the
// trend. Scores are kept on the contract and audited there. A contract's measures are read with
// `contracts.view` and changed with `contracts.edit`.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { assertNotHeld } from '../../core/holds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { addMonths, monthEndOf } from '../../../../shared/dates.ts';
import { CLOSED_CONTRACT_STATUSES } from './reminders.ts';
import { addDays, localDate } from './dates.ts';

export type Frequency = 'monthly' | 'quarterly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'yearly'];
export type Direction = 'higher' | 'lower';
export type Trend = 'improving' | 'worsening' | 'steady';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The first and last day of a period ("2026-10", "2026-Q3", "2026"), or null when it is not one of that frequency. */
export function periodRange(period: string, frequency: Frequency): { start: string; end: string } | null {
  if (frequency === 'monthly') {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
    if (!m) return null;
    const start = `${m[1]}-${m[2]}-01`;
    return { start, end: monthEndOf(start) };
  }
  if (frequency === 'quarterly') {
    const m = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!m) return null;
    const first = (Number(m[2]) - 1) * 3 + 1;
    const start = `${m[1]}-${String(first).padStart(2, '0')}-01`;
    return { start, end: monthEndOf(addMonths(start, 2)) };
  }
  const m = /^(\d{4})$/.exec(period);
  return m ? { start: `${m[1]}-01-01`, end: `${m[1]}-12-31` } : null;
}

/** The period a date falls in. */
export function periodOf(date: string, frequency: Frequency): string {
  const y = date.slice(0, 4);
  if (frequency === 'yearly') return y;
  const month = Number(date.slice(5, 7));
  return frequency === 'monthly' ? date.slice(0, 7) : `${y}-Q${Math.ceil(month / 3)}`;
}

/** The last period that has ended by `today`: the one a score is due for. */
export function duePeriod(today: string, frequency: Frequency): string {
  const current = periodRange(periodOf(today, frequency), frequency)!;
  return periodOf(addDays(current.start, -1), frequency);
}

export function periodLabel(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

export const meets = (value: number, target: number, direction: Direction) => (direction === 'lower' ? value <= target : value >= target);

/**
 * The trend of a measure: the straight line that best fits its last six scores (least squares),
 * turned so that "improving" is always the better way. A change along that line of no more than
 * 0.5% of the target (or of 1) counts as steady. Null with fewer than two scores.
 */
export function trendOf(values: number[], target: number, direction: Direction): Trend | null {
  if (values.length < 2) return null;
  const ys = values.slice(-6);
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => { num += (x - meanX) * (y - meanY); den += (x - meanX) ** 2; });
  const change = (num / den) * (n - 1);
  if (Math.abs(change) <= Math.max(Math.abs(target), 1) * 0.005) return 'steady';
  return (direction === 'lower' ? -change : change) > 0 ? 'improving' : 'worsening';
}

const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : null;
};

/** A contract's measures, each with its scores (oldest first), the latest result, the trend and whether a score is due. */
export async function contractPerformance(ctx: ModuleContext, contract: Row, today: string = localDate()) {
  const measures = await ctx.db.query<Row>(
    `select *, created_at::date::text as created_on from contract_measures where contract_id = $1 and deleted_at is null order by sort, created_at`, [contract.id]);
  const scores = await ctx.db.query<Row>(
    `select s.*, s.period_end::text as period_end, u.display_name as recorded_by_name
     from contract_scores s left join users u on u.id = s.recorded_by
     where s.contract_id = $1 and s.deleted_at is null order by s.period_end`, [contract.id]);
  const open = !CLOSED_CONTRACT_STATUSES.includes(contract.status);
  return measures.map((m) => {
    const target = Number(m.target);
    const direction = m.direction as Direction;
    const frequency = m.frequency as Frequency;
    const mine = scores.filter((s) => s.measure_id === m.id).map((s) => {
      const value = Number(s.value);
      return {
        id: s.id, period: s.period, period_label: periodLabel(s.period), period_end: s.period_end, value,
        met: meets(value, target, direction), comment: s.comment ?? null, recorded_by_name: s.recorded_by_name ?? null, updated_at: s.updated_at,
      };
    });
    const latest = mine[mine.length - 1] ?? null;
    const due = duePeriod(today, frequency);
    const dueEnd = periodRange(due, frequency)!.end;
    const scoreDue = open && m.active && m.created_on <= dueEnd && !mine.some((s) => s.period === due);
    return {
      id: m.id, name: m.name, description: m.description ?? null, unit: m.unit ?? null, target, direction, frequency,
      active: m.active, sort: m.sort, scores: mine, latest,
      met_count: mine.filter((s) => s.met).length,
      trend: trendOf(mine.map((s) => s.value), target, direction),
      due_period: scoreDue ? due : null, due_period_label: scoreDue ? periodLabel(due) : null,
    };
  });
}

export function registerPerformance(ctx: ModuleContext): void {
  const { app, db } = ctx;

  async function needContract(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    if (!UUID_RE.test(id)) ctx.fail(404, 'not_found', 'Contract not found.');
    return (await ctx.resources.find('contract', id, req.user)) ?? ctx.fail(404, 'not_found', 'Contract not found.');
  }
  async function needMeasure(contract: Row, measureId: string): Promise<Row> {
    const row = UUID_RE.test(measureId)
      ? await db.one<Row>('select * from contract_measures where id = $1 and contract_id = $2 and deleted_at is null', [measureId, contract.id])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Measure not found.');
  }
  async function needScore(contract: Row, scoreId: string): Promise<Row> {
    const row = UUID_RE.test(scoreId)
      ? await db.one<Row>(
        `select s.*, m.name as measure_name, m.target, m.direction from contract_scores s join contract_measures m on m.id = s.measure_id
         where s.id = $1 and s.contract_id = $2 and s.deleted_at is null and m.deleted_at is null`, [scoreId, contract.id])
      : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Score not found.');
  }

  function measureInput(b: Row, mode: 'create' | 'update'): Row {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (mode === 'create' || b.name !== undefined) {
      out.name = clean(b.name, 200);
      if (!out.name) fields.name = 'Name the measure.';
    }
    if (b.description !== undefined) out.description = clean(b.description, 2000);
    if (b.unit !== undefined) out.unit = clean(b.unit, 40);
    if (mode === 'create' || b.target !== undefined) {
      out.target = num(b.target);
      if (out.target === null) fields.target = 'Enter the target as a number.';
    }
    if (mode === 'create' || b.direction !== undefined) {
      out.direction = b.direction ?? 'higher';
      if (!['higher', 'lower'].includes(out.direction)) fields.direction = 'Choose whether higher or lower is better.';
    }
    if (mode === 'create' || b.frequency !== undefined) {
      out.frequency = b.frequency ?? 'monthly';
      if (!FREQUENCIES.includes(out.frequency)) fields.frequency = 'Choose monthly, quarterly or yearly.';
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') fields.active = 'Send true or false.';
      else out.active = b.active;
    }
    if (b.sort !== undefined) {
      const n = num(b.sort);
      if (n === null || !Number.isInteger(n)) fields.sort = 'Send a whole number.';
      else out.sort = n;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  // ---------- reading ----------

  app.get('/api/contracts/:id/performance', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
    const contract = await needContract(req);
    const measures = await contractPerformance(ctx, contract);
    return {
      today: localDate(),
      measures,
      summary: {
        measures: measures.filter((m) => m.active).length,
        met: measures.filter((m) => m.active && m.latest?.met === true).length,
        below: measures.filter((m) => m.active && m.latest?.met === false).length,
        due: measures.filter((m) => m.due_period).length,
      },
      can_edit: ctx.can(req.user, 'contracts.edit'),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/contracts/:id/performance', tag: 'Contracts', permission: 'contracts.view',
    summary: 'A contract\'s performance measures with their targets, every score with its comment, whether each met the target, the trend and any score due',
    response: '{ today, measures: [{ id, name, description, unit, target, direction, frequency, active, scores: [{ id, period, period_label, period_end, value, met, comment, recorded_by_name }], latest, met_count, trend: "improving" | "worsening" | "steady" | null, due_period, due_period_label }], summary: { measures, met, below, due }, can_edit }',
  });

  // Every contract with measures: the review across contractors.
  app.get('/api/contracts/performance', { preHandler: ctx.requirePerm('contracts.view') }, async (req) => {
    const seesVendors = ctx.can(req.user, 'vendors.view');
    const contracts = await db.query<Row>(
      `select c.id, c.ref, c.title, c.status, c.vendor_id, v.name as vendor_name, c.owner_id, u.display_name as owner_name
       from contracts c left join vendors v on v.id = c.vendor_id left join users u on u.id = c.owner_id
       where c.deleted_at is null and ${ctx.resources.visibleWhere('contract', req.user, 'c')}
         and exists (select 1 from contract_measures m where m.contract_id = c.id and m.deleted_at is null)
       order by c.title`);
    const today = localDate();
    const rows = [];
    for (const c of contracts) {
      const measures = (await contractPerformance(ctx, c, today)).filter((m) => m.active);
      rows.push({
        id: c.id, ref: c.ref, title: c.title, status: c.status, vendor_id: c.vendor_id, vendor_name: seesVendors ? c.vendor_name : null,
        owner_name: c.owner_name ?? null,
        measures: measures.length,
        met: measures.filter((m) => m.latest?.met === true).length,
        below: measures.filter((m) => m.latest?.met === false).length,
        not_scored: measures.filter((m) => !m.latest).length,
        due: measures.filter((m) => m.due_period).length,
        worsening: measures.filter((m) => m.trend === 'worsening').length,
        below_names: measures.filter((m) => m.latest?.met === false).map((m) => m.name),
      });
    }
    return { today, rows };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/contracts/performance', tag: 'Contracts', permission: 'contracts.view',
    summary: 'Every contract with performance measures: how many met their target at the latest score, how many fell below, how many are worsening and how many scores are due',
    response: '{ today, rows: [{ id, ref, title, status, vendor_id, vendor_name, owner_name, measures, met, below, not_scored, due, worsening, below_names }] }',
  });

  // ---------- measures ----------

  app.post('/api/contracts/:id/measures', { preHandler: ctx.requirePerm('contracts.edit') }, async (req, reply) => {
    const contract = await needContract(req);
    const data = measureInput((req.body ?? {}) as Row, 'create');
    const sort = data.sort ?? Number((await db.one<Row>('select coalesce(max(sort), 0) + 10 as n from contract_measures where contract_id = $1 and deleted_at is null', [contract.id]))!.n);
    const row = (await db.one<Row>(
      `insert into contract_measures (contract_id, name, description, unit, target, direction, frequency, sort, active, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning *`,
      [contract.id, data.name, data.description ?? null, data.unit ?? null, data.target, data.direction, data.frequency, sort, data.active ?? true, req.user!.id],
    ))!;
    await ctx.audit(req, {
      action: 'contract.measure_add', recordType: 'contract', recordId: contract.id,
      summary: `Performance measure added to ${contract.title}: ${row.name} (target ${data.direction === 'lower' ? 'at most' : 'at least'} ${data.target}${data.unit ? ` ${data.unit}` : ''}, ${data.frequency})`,
      after: { measure_id: row.id, name: row.name, target: data.target, direction: data.direction, frequency: data.frequency, unit: row.unit },
    });
    reply.code(201);
    return (await contractPerformance(ctx, contract)).find((m) => m.id === row.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/contracts/:id/measures', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Add a performance measure with a target to a contract',
    body: '{ name: string, target: number, direction?: "higher" | "lower" (which is better; default higher), frequency?: "monthly" | "quarterly" | "yearly" (default monthly), unit?: string, description?: string, sort?: number }',
    response: 'the measure, as in GET /api/contracts/:id/performance',
  });

  app.patch('/api/contracts/:id/measures/:measureId', { preHandler: ctx.requirePerm('contracts.edit') }, async (req) => {
    const contract = await needContract(req);
    const existing = await needMeasure(contract, String((req.params as Row).measureId));
    const data = measureInput((req.body ?? {}) as Row, 'update');
    if (data.frequency !== undefined && data.frequency !== existing.frequency) {
      const scored = await db.one('select 1 from contract_scores where measure_id = $1 and deleted_at is null limit 1', [existing.id]);
      if (scored) ctx.fail(400, 'validation', 'Check the highlighted fields.', { frequency: 'This measure already has scores; add a new measure for a different frequency.' });
    }
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(data)) {
      const old = k === 'target' ? Number(existing[k]) : existing[k] ?? null;
      if (old !== (v ?? null)) { before[k] = old; after[k] = v; }
    }
    if (Object.keys(after).length) {
      const m = { ...existing, ...after };
      await db.query(
        `update contract_measures set name = $2, description = $3, unit = $4, target = $5, direction = $6, frequency = $7, sort = $8, active = $9,
           updated_at = now(), updated_by = $10 where id = $1`,
        [existing.id, m.name, m.description, m.unit, m.target, m.direction, m.frequency, m.sort, m.active, req.user!.id]);
      await ctx.audit(req, {
        action: 'contract.measure_update', recordType: 'contract', recordId: contract.id,
        summary: `Performance measure changed on ${contract.title}: ${m.name}`, before: { measure_id: existing.id, ...before }, after: { measure_id: existing.id, ...after },
      });
    }
    return (await contractPerformance(ctx, contract)).find((m) => m.id === existing.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/contracts/:id/measures/:measureId', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Change a performance measure: its name, target, direction, unit, description, order, or stop scoring it (active false). The frequency cannot change once it has scores.',
    body: '{ name?, target?, direction?, frequency?, unit?, description?, sort?, active?: boolean }',
    response: 'the measure',
  });

  app.delete('/api/contracts/:id/measures/:measureId', { preHandler: ctx.requirePerm('contracts.edit') }, async (req) => {
    const contract = await needContract(req);
    const existing = await needMeasure(contract, String((req.params as Row).measureId));
    await assertNotHeld(db, 'contract', contract.id, 'delete');
    const scores = Number((await db.one<Row>('select count(*)::int as n from contract_scores where measure_id = $1 and deleted_at is null', [existing.id]))!.n);
    await db.tx(async (tx) => {
      await tx.query('update contract_scores set deleted_at = now(), updated_by = $2 where measure_id = $1 and deleted_at is null', [existing.id, req.user!.id]);
      await tx.query('update contract_measures set deleted_at = now(), updated_by = $2 where id = $1', [existing.id, req.user!.id]);
    });
    await ctx.audit(req, {
      action: 'contract.measure_remove', recordType: 'contract', recordId: contract.id,
      summary: `Performance measure removed from ${contract.title}: ${existing.name}${scores ? ` and its ${scores} score${scores === 1 ? '' : 's'}` : ''}`,
      before: { measure_id: existing.id, name: existing.name, target: Number(existing.target), scores },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/contracts/:id/measures/:measureId', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Remove a performance measure and its scores (refused while the contract is under a legal hold; to stop scoring but keep the history, set active to false)',
    response: '{ ok: true }',
  });

  // ---------- scores ----------

  app.post('/api/contracts/:id/measures/:measureId/scores', { preHandler: ctx.requirePerm('contracts.edit') }, async (req, reply) => {
    const contract = await needContract(req);
    const measure = await needMeasure(contract, String((req.params as Row).measureId));
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const frequency = measure.frequency as Frequency;
    const period = typeof b.period === 'string' ? b.period.trim() : '';
    const range = periodRange(period, frequency);
    const today = localDate();
    const example = { monthly: '2026-10', quarterly: '2026-Q3', yearly: '2026' }[frequency];
    if (!range) fields.period = `Enter the ${frequency === 'monthly' ? 'month' : frequency === 'quarterly' ? 'quarter' : 'year'} scored, such as ${example}.`;
    else if (range.start > today) fields.period = 'This period has not started yet.';
    const value = num(b.value);
    if (value === null) fields.value = 'Enter the score as a number.';
    const comment = clean(b.comment, 4000);
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    const row = await db.one<Row>(
      `insert into contract_scores (measure_id, contract_id, period, period_end, value, comment, recorded_by, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$7,$7)
       on conflict (measure_id, period) where deleted_at is null do nothing returning id`,
      [measure.id, contract.id, period, range!.end, value, comment, req.user!.id]);
    if (!row) ctx.fail(409, 'conflict', `A score for ${periodLabel(period)} is already recorded. Change that score instead.`, { period: 'Already scored.' });
    const met = meets(value!, Number(measure.target), measure.direction as Direction);
    await ctx.audit(req, {
      action: 'contract.score', recordType: 'contract', recordId: contract.id,
      summary: `Performance score recorded on ${contract.title}: ${measure.name}, ${periodLabel(period)} = ${value}${measure.unit ? ` ${measure.unit}` : ''} (${met ? 'met' : 'below'} target ${Number(measure.target)})`,
      after: { score_id: row.id, measure_id: measure.id, period, value, met, comment },
    });
    reply.code(201);
    return (await contractPerformance(ctx, contract)).find((m) => m.id === measure.id);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/contracts/:id/measures/:measureId/scores', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Record a measure\'s score for one period, with a comment',
    description: 'The period follows the measure\'s frequency: "2026-10" (monthly), "2026-Q3" (quarterly) or "2026" (yearly), and must have started. One score per measure and period: a second answers 409 conflict.',
    body: '{ period: string, value: number, comment?: string }',
    response: 'the measure with its scores',
  });

  app.patch('/api/contracts/:id/scores/:scoreId', { preHandler: ctx.requirePerm('contracts.edit') }, async (req) => {
    const contract = await needContract(req);
    const existing = await needScore(contract, String((req.params as Row).scoreId));
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    const next: Row = {};
    if (b.value !== undefined) {
      const value = num(b.value);
      if (value === null) fields.value = 'Enter the score as a number.';
      else if (value !== Number(existing.value)) next.value = value;
    }
    if (b.comment !== undefined) {
      const comment = clean(b.comment, 4000);
      if (comment !== (existing.comment ?? null)) next.comment = comment;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (Object.keys(next).length) {
      // The save checks the version the person saw (updated_at), so two people changing one score cannot overwrite each other unseen.
      const seen = b.updated_at ? String(b.updated_at) : null;
      const saved = await db.one<Row>(
        `update contract_scores set value = $2, comment = $3, updated_at = now(), updated_by = $4
         where id = $1 and deleted_at is null
           and ($5::timestamptz is null or abs(extract(epoch from (updated_at - $5::timestamptz))) < 0.001) returning id`,
        [existing.id, next.value ?? existing.value, 'comment' in next ? next.comment : existing.comment, req.user!.id, seen]);
      if (!saved) ctx.fail(409, 'version_conflict', 'Someone else changed this score. Reload to see their change.');
      await ctx.audit(req, {
        action: 'contract.score_update', recordType: 'contract', recordId: contract.id,
        summary: `Performance score changed on ${contract.title}: ${existing.measure_name}, ${periodLabel(existing.period)}`,
        before: { score_id: existing.id, ...Object.fromEntries(Object.keys(next).map((k) => [k, k === 'value' ? Number(existing.value) : existing[k]])) },
        after: { score_id: existing.id, ...next },
      });
    }
    return (await contractPerformance(ctx, contract)).find((m) => m.id === existing.measure_id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/contracts/:id/scores/:scoreId', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Correct a score\'s value or comment',
    description: 'Send the score\'s updated_at as it was read to refuse the save (409 version_conflict) when someone else changed it since.',
    body: '{ value?: number, comment?: string, updated_at?: timestamp }',
    response: 'the measure with its scores',
  });

  app.delete('/api/contracts/:id/scores/:scoreId', { preHandler: ctx.requirePerm('contracts.edit') }, async (req) => {
    const contract = await needContract(req);
    const existing = await needScore(contract, String((req.params as Row).scoreId));
    await assertNotHeld(db, 'contract', contract.id, 'delete');
    await db.query('update contract_scores set deleted_at = now(), updated_by = $2 where id = $1', [existing.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'contract.score_remove', recordType: 'contract', recordId: contract.id,
      summary: `Performance score removed from ${contract.title}: ${existing.measure_name}, ${periodLabel(existing.period)}`,
      before: { score_id: existing.id, period: existing.period, value: Number(existing.value), comment: existing.comment },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/contracts/:id/scores/:scoreId', tag: 'Contracts', permission: 'contracts.edit',
    summary: 'Remove a score recorded in error (refused while the contract is under a legal hold)',
    response: '{ ok: true }',
  });
}
