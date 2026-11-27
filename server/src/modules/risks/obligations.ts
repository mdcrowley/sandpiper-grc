import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addMonths, addDays } from '../../../../shared/dates.ts';
export { addMonths, addDays }; // one copy for every module (E40-12)

// The obligations register: the `obligation` record type, with its type, frequency and what it
// applies to (E30-01, contract C5), and the history of each period attested (E30-02). Due-date
// and period reminders are in obligation-reminders.ts.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_APPLIES_TO = 50;
const MAX_LABEL = 200;

/** One entry of an obligation's `applies_to`: free text, or a record of another type with its label. */
export interface AppliesTo { label: string; type?: string; id?: string }

/** The lists of the obligations register. Called from risks/index.ts `seedDefaults`; idempotent. */
export async function seedObligationDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('obligation_status', [
    { value: 'not_assessed', label: 'Not assessed', color: 'gray', sort: 10 },
    { value: 'met', label: 'Met', color: 'green', sort: 20 },
    { value: 'partly_met', label: 'Partly met', color: 'amber', sort: 30 },
    { value: 'not_met', label: 'Not met', color: 'red', sort: 40 },
  ], { module: 'obligations' });
  // Contract C5: the funding module files award reporting conditions as `funding_condition`.
  await ctx.lookups.ensure('obligation_type', [
    { value: 'law', label: 'Law or regulation', color: 'blue', sort: 10 },
    { value: 'permit', label: 'License or permit', color: 'teal', sort: 20 },
    { value: 'contract', label: 'Contract', color: 'purple', sort: 30 },
    { value: 'funding_condition', label: 'Funding condition', color: 'green', sort: 40 },
    { value: 'standard', label: 'Standard or certification', color: 'amber', sort: 50 },
    { value: 'internal', label: 'Internal policy', color: 'gray', sort: 60 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], { module: 'obligations' });
  // meta.months: how far one period moves the next due date (none for a one-off obligation).
  await ctx.lookups.ensure('obligation_frequency', [
    { value: 'once', label: 'Once', color: 'gray', sort: 10, meta: { months: 0 } },
    { value: 'monthly', label: 'Monthly', color: 'blue', sort: 20, meta: { months: 1 } },
    { value: 'quarterly', label: 'Quarterly', color: 'blue', sort: 30, meta: { months: 3 } },
    { value: 'half_yearly', label: 'Every six months', color: 'blue', sort: 40, meta: { months: 6 } },
    { value: 'yearly', label: 'Yearly', color: 'blue', sort: 50, meta: { months: 12 } },
    { value: 'every_2_years', label: 'Every 2 years', color: 'teal', sort: 60, meta: { months: 24 } },
    { value: 'every_3_years', label: 'Every 3 years', color: 'teal', sort: 70, meta: { months: 36 } },
  ], { module: 'obligations' });
}

/** Months one period of `frequency` covers; 0 for a one-off or unknown frequency. */
export async function frequencyMonths(ctx: ModuleContext, frequency: string | null | undefined): Promise<number> {
  if (!frequency) return 0;
  const v = (await ctx.lookups.values('obligation_frequency')).find((x) => x.value === frequency);
  const n = Number(v?.meta?.months ?? 0);
  return Number.isInteger(n) && n > 0 && n <= 120 ? n : 0;
}

/**
 * The period that ends on an obligation's next due date: it starts the day after the same date one
 * frequency earlier. A one-off obligation (or one without a frequency) has a one-day period.
 */
export function periodEndingOn(due: string, months: number): { period_start: string; period_end: string; due_on: string } {
  return { period_start: months ? addDays(addMonths(due, -months), 1) : due, period_end: due, due_on: due };
}

export function registerObligations(ctx: ModuleContext): void {
  /** Checks and normalizes `applies_to`: at most 50 entries, each free text or a visible, unrestricted record. */
  async function cleanAppliesTo(req: FastifyRequest | null, value: unknown): Promise<AppliesTo[]> {
    if (value === null || value === undefined || value === '') return [];
    const bad = (msg: string): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', { applies_to: msg });
    if (!Array.isArray(value)) bad('Applies to must be a list.');
    const list = value as unknown[];
    if (list.length > MAX_APPLIES_TO) bad(`Applies to may name at most ${MAX_APPLIES_TO} things.`);
    const out: AppliesTo[] = [];
    for (const raw of list) {
      const entry: Row = typeof raw === 'string' ? { label: raw } : (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : bad('Each entry of Applies to is a name or a record.'));
      const type = entry.type == null || entry.type === '' ? undefined : String(entry.type);
      const id = entry.id == null || entry.id === '' ? undefined : String(entry.id);
      if (type || id) {
        if (!type || !id || !UUID.test(id)) bad('A record in Applies to needs its type and id.');
        const def = ctx.resources.get(type!);
        if (!def) bad(`Applies to names a record type that is not available: ${type}.`);
        // The obligation is not restricted, so it never names a restricted record.
        if (def!.restricted === true) bad(`${def!.plural} are restricted and cannot be named in Applies to.`);
        const row = await ctx.resources.find(type!, id!, req?.user ?? null);
        if (!row) bad(`Applies to names a ${def!.label.toLowerCase()} that does not exist.`);
        if (row!.restricted === true) bad(`That ${def!.label.toLowerCase()} is restricted and cannot be named in Applies to.`);
        const label = (await ctx.resources.labelFor(type!, id!)) ?? String(entry.label ?? '').trim();
        out.push({ label: label.slice(0, MAX_LABEL), type, id });
      } else {
        const label = String(entry.label ?? '').trim();
        if (!label) continue;
        if (label.length > MAX_LABEL) bad(`Each entry of Applies to is at most ${MAX_LABEL} characters.`);
        out.push({ label });
      }
    }
    const seen = new Set<string>();
    return out.filter((e) => {
      const k = e.type ? `${e.type}:${e.id}` : `text:${e.label.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async function prepare(req: FastifyRequest | null, data: Row): Promise<Row> {
    if (data.applies_to !== undefined) data.applies_to = await cleanAppliesTo(req, data.applies_to);
    return data;
  }

  ctx.defineResource({
    type: 'obligation', table: 'obligations', module: 'obligations', label: 'Obligation', plural: 'Obligations',
    path: '/api/obligations', route: '/obligations', titleField: 'title', ref: { field: 'ref', prefix: 'OBL-' },
    searchable: ['title', 'source', 'requirement', 'how_met', 'evidence'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Obligation', type: 'text', required: true },
      source: { label: 'Source', type: 'text' },
      type: { label: 'Type', type: 'lookup', list: 'obligation_type' },
      frequency: { label: 'Frequency', type: 'lookup', list: 'obligation_frequency' },
      applies_to: { label: 'Applies to', type: 'json', personal: false },
      requirement: { label: 'Requirement', type: 'longtext' },
      owner_id: { label: 'Owner', type: 'user' },
      how_met: { label: 'How it is met', type: 'longtext' },
      evidence: { label: 'Evidence', type: 'longtext' },
      next_due_on: { label: 'Next due', type: 'date' },
      last_attested_on: { label: 'Last attested', type: 'date', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'obligation_status', default: 'not_assessed' },
    },
    hooks: {
      beforeCreate: (req, data) => prepare(req, data),
      beforeUpdate: (req, _existing, patch) => prepare(req, patch),
    },
  });

  registerPeriodRoutes(ctx);

  // Obligations are organization data: none are created here. They come from the
  // organization profile at seed time (see seed.ts) or are entered by hand.
}

// ------------------------------------------------------------------ periods (E30-02)

const PERIOD_COLUMNS = `p.id, p.obligation_id, p.period_start::text as period_start, p.period_end::text as period_end,
  p.due_on::text as due_on, p.status, p.attested_by, u.display_name as attested_by_name, p.attested_on::text as attested_on,
  p.note, p.evidence, p.created_at, p.updated_at`;

function registerPeriodRoutes(ctx: ModuleContext): void {
  const validDate = (v: unknown) => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
  const obligationOf = async (req: FastifyRequest) =>
    (await ctx.resources.find('obligation', (req.params as any).id, req.user)) ?? ctx.fail(404, 'not_found', 'Obligation not found.');
  const periodRow = (id: string) => ctx.db.one<Row>(`select ${PERIOD_COLUMNS} from obligation_periods p left join users u on u.id = p.attested_by where p.id = $1`, [id]);

  /** The next period to attest: the one ending on the next due date, unless that period is already recorded. */
  async function suggestion(o: Row, latest: Row | undefined) {
    const months = await frequencyMonths(ctx, o.frequency);
    const due: string | null = o.next_due_on ? String(o.next_due_on).slice(0, 10) : null;
    if (due) {
      const p = periodEndingOn(due, months);
      if (!latest || latest.period_start < p.period_start) return p;
    }
    if (latest && months) {
      const end = addMonths(latest.period_end, months);
      return { period_start: addDays(latest.period_end, 1), period_end: end, due_on: end };
    }
    return null;
  }

  ctx.app.get('/api/obligations/:id/periods', { preHandler: ctx.requirePerm('obligations.view') }, async (req) => {
    const o = await obligationOf(req);
    const periods = await ctx.db.query<Row>(
      `select ${PERIOD_COLUMNS} from obligation_periods p left join users u on u.id = p.attested_by
       where p.obligation_id = $1 order by p.period_start desc limit 500`, [o.id]);
    return { periods, next: await suggestion(o, periods[0]), months: await frequencyMonths(ctx, o.frequency) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/obligations/:id/periods', permission: 'obligations.view',
    summary: "An obligation's periods, newest first, with the next period to attest",
    response: '{ periods: [{ id, period_start, period_end, due_on, status, attested_by, attested_by_name, attested_on, note, evidence }], next: { period_start, period_end, due_on } | null, months }',
  });

  ctx.app.post('/api/obligations/:id/periods', { preHandler: ctx.requirePerm('obligations.edit') }, async (req, reply) => {
    const o = await obligationOf(req);
    const b = (req.body ?? {}) as Row;
    const latest = await ctx.db.one<Row>(`select period_start::text as period_start, period_end::text as period_end from obligation_periods where obligation_id = $1 order by period_start desc limit 1`, [o.id]);
    const s = await suggestion(o, latest);
    const pick = (k: 'period_start' | 'period_end' | 'due_on') => (b[k] === undefined || b[k] === null || b[k] === '' ? s?.[k] ?? null : b[k]);
    const start = pick('period_start');
    const end = pick('period_end');
    const due = pick('due_on') ?? end;
    const errors: Record<string, string> = {};
    if (!validDate(start)) errors.period_start = 'Give the first day of the period (YYYY-MM-DD).';
    if (!validDate(end)) errors.period_end = 'Give the last day of the period (YYYY-MM-DD).';
    else if (validDate(start) && end < start) errors.period_end = 'The period must end on or after the day it starts.';
    if (due !== null && !validDate(due)) errors.due_on = 'Due must be a date (YYYY-MM-DD).';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (await ctx.db.one('select 1 from obligation_periods where obligation_id = $1 and period_start = $2', [o.id, start])) {
      ctx.fail(409, 'period_exists', 'A period starting on that day is already recorded for this obligation.');
    }
    const row = (await ctx.db.one<{ id: string }>(
      `insert into obligation_periods (obligation_id, period_start, period_end, due_on, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $5) returning id`, [o.id, start, end, due, req.user!.id]))!;
    const saved = (await periodRow(row.id))!;
    await ctx.audit(req, {
      action: 'obligation.period_add', recordType: 'obligation', recordId: o.id,
      summary: `Period ${start} to ${end} added to ${o.ref ?? o.title}`, after: saved,
    });
    reply.code(201);
    return saved;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/obligations/:id/periods', permission: 'obligations.edit',
    summary: 'Adds a period to an obligation (by default the one ending on its next due date)',
    body: { type: 'object', properties: { period_start: { type: 'string', format: 'date' }, period_end: { type: 'string', format: 'date' }, due_on: { type: 'string', format: 'date' } } },
    response: 'The period',
  });

  ctx.app.post('/api/obligations/:id/periods/:pid/attest', { preHandler: ctx.requirePerm('obligations.edit') }, async (req) => {
    const o = await obligationOf(req);
    const pid = String((req.params as any).pid);
    const before = UUID.test(pid) ? await periodRow(pid) : undefined;
    if (!before || before.obligation_id !== o.id) ctx.fail(404, 'not_found', 'Period not found.');
    const b = (req.body ?? {}) as Row;
    const allowed = (await ctx.lookups.values('obligation_status')).filter((v) => v.value !== 'not_assessed').map((v) => v.value);
    const errors: Record<string, string> = {};
    const status = String(b.status ?? '');
    if (!allowed.includes(status)) errors.status = `Say whether the period was met: ${allowed.join(', ')}.`;
    const attestedOn = b.attested_on ? String(b.attested_on) : dayInZone();
    if (!validDate(attestedOn)) errors.attested_on = 'Attested on must be a date (YYYY-MM-DD).';
    else if (attestedOn > dayInZone()) errors.attested_on = 'A period cannot be attested in the future.';
    const note = String(b.note ?? '').trim();
    const evidence = String(b.evidence ?? '').trim();
    if (note.length > 4000) errors.note = 'The note is at most 4,000 characters.';
    if (evidence.length > 4000) errors.evidence = 'The evidence is at most 4,000 characters.';
    if (status !== 'met' && allowed.includes(status) && !note) errors.note = 'Say what was not met, and what is being done about it.';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    await ctx.db.query(
      `update obligation_periods set status = $2, attested_by = $3, attested_on = $4, note = $5, evidence = $6, updated_at = now(), updated_by = $3 where id = $1`,
      [before!.id, status, actorOf(req).id, attestedOn, note || null, evidence || null]);
    const after = (await periodRow(before!.id))!;
    await ctx.audit(req, {
      action: 'obligation.attest', recordType: 'obligation', recordId: o.id,
      summary: `Period ${after.period_start} to ${after.period_end} of ${o.ref ?? o.title} attested: ${status.replace('_', ' ')}`,
      before, after,
    });

    // The obligation follows its latest period: its status, and the next due date rolled on by the frequency.
    const latest = await ctx.db.one<{ id: string }>('select id from obligation_periods where obligation_id = $1 order by period_start desc limit 1', [o.id]);
    let obligation = o;
    if (latest?.id === after.id) {
      const patch: Row = {};
      if (o.status !== status) patch.status = status;
      const months = await frequencyMonths(ctx, o.frequency);
      const base = after.due_on ?? after.period_end;
      const current = o.next_due_on ? String(o.next_due_on).slice(0, 10) : null;
      if (months && (!current || current <= base)) patch.next_due_on = addMonths(base, months);
      if (Object.keys(patch).length) obligation = await ctx.resources.update('obligation', o.id, patch, req);
    }
    await ctx.db.query('update obligations set last_attested_on = greatest(last_attested_on, $2::date) where id = $1', [o.id, attestedOn]);
    return { period: after, obligation: { ...obligation, last_attested_on: (await ctx.db.one<{ d: string | null }>('select last_attested_on::text as d from obligations where id = $1', [o.id]))?.d ?? null } };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/obligations/:id/periods/:pid/attest', permission: 'obligations.edit',
    summary: 'Attests one period of an obligation; the latest period sets the status and rolls the next due date on',
    body: { type: 'object', required: ['status'], properties: { status: { type: 'string', description: 'met, partly_met or not_met' }, attested_on: { type: 'string', format: 'date' }, note: { type: 'string', description: 'Required unless met' }, evidence: { type: 'string' } } },
    response: '{ period, obligation }',
  });
}
