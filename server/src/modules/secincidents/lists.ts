import type { FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { KIND_LIST, KIND_PREFIX, STAGES } from './defaults.ts';

// The two configurable lists that drive this module's behavior, editable on the rules screen
// by people with security.administer (Administration > Lists needs admin.administer):
//   kinds     incident_data_kind        each value is a yes/no question and a rule trigger
//   statuses  security_incident_status  the incident lifecycle; `stage` says what a status means
// Values are retired (active = false), never deleted, so old records keep their meaning.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'];
const LISTS: Record<string, { list: string; noun: string; extra: 'hint' | 'stage' }> = {
  kinds: { list: KIND_LIST, noun: 'Kind of data', extra: 'hint' },
  statuses: { list: 'security_incident_status', noun: 'Incident status', extra: 'stage' },
};

const slug = (label: string) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

export function registerLists(
  ctx: ModuleContext,
  guards: { view: RouteShorthandOptions; administer: RouteShorthandOptions },
) {
  const { app, db } = ctx;

  const which = (req: FastifyRequest) =>
    LISTS[String((req.params as Row).name ?? '')] ?? ctx.fail(404, 'not_found', 'List not found.');

  const shape = (r: Row, extra: 'hint' | 'stage') => ({
    id: r.id, value: r.value, label: r.label, color: r.color, sort: r.sort, active: r.active,
    [extra]: typeof r.meta?.[extra] === 'string' ? r.meta[extra] : '',
  });

  /** How many records use a value; a value in use cannot be retired. */
  async function inUse(listName: string, value: string): Promise<string | null> {
    if (listName === 'kinds') {
      const rule = await db.one<Row>(
        `select party from notification_rules where deleted_at is null and active and trigger_attribute = $1 limit 1`, [`${KIND_PREFIX}${value}`]);
      return rule ? `The active notification rule "${rule.party}" is triggered by this kind of data. Switch that rule off or change its trigger first.` : null;
    }
    const n = (await db.one<{ c: number }>(
      `select count(*)::int c from security_incidents where deleted_at is null and status = $1`, [value]))!.c;
    if (n) return `${n} incident${n === 1 ? ' has' : 's have'} this status. Move ${n === 1 ? 'it' : 'them'} to another status first.`;
    return null;
  }

  /** The lifecycle must always be able to hold a reported, a declared and a closed incident. */
  async function checkStages(change: { id?: string; stage?: string; active?: boolean }) {
    const rows = await db.query<Row>(`select id, value, label, color, sort, active, meta from lookups where list_key = 'security_incident_status' order by sort, label`);
    const after = rows.map((r) => (r.id === change.id
      ? { ...r, active: change.active ?? r.active, meta: { ...(r.meta ?? {}), ...(change.stage ? { stage: change.stage } : {}) } }
      : r)).filter((r) => r.active);
    const have = new Set(after.map((r) => r.meta?.stage));
    const missing = ['reported', 'declared', 'closed'].filter((s) => !have.has(s));
    if (missing.length) {
      ctx.fail(409, 'lifecycle', `The lifecycle needs at least one status for each of: before declaration, declared and closed. This change would leave none for "${missing[0]}".`);
    }
  }

  app.get('/api/security-incidents/lists/:name', guards.view, async (req) => {
    const l = which(req);
    const rows = await db.query<Row>(
      `select id, value, label, color, sort, active, meta from lookups where list_key = $1 order by active desc, sort, label`, [l.list]);
    return rows.map((r) => shape(r, l.extra));
  });

  function parse(l: (typeof LISTS)[string], b: Row, mode: 'create' | 'update') {
    const out: Row = {};
    const fields: Record<string, string> = {};
    if (b.label !== undefined || mode === 'create') {
      const label = String(b.label ?? '').trim();
      if (!label) fields.label = 'Name is required.';
      else if (label.length > 120) fields.label = 'Name is too long.';
      else out.label = label;
    }
    if (b.color !== undefined && b.color !== null && b.color !== '') {
      if (COLORS.includes(String(b.color))) out.color = String(b.color); else fields.color = 'Choose a color from the list.';
    }
    if (b.sort !== undefined && b.sort !== null && b.sort !== '') {
      const n = Number(b.sort);
      if (Number.isFinite(n) && n >= 0 && n < 100000) out.sort = Math.round(n); else fields.sort = 'Order must be a number.';
    }
    if (b.active !== undefined && mode === 'update') {
      if (typeof b.active === 'boolean') out.active = b.active; else fields.active = 'Active must be yes or no.';
    }
    if (l.extra === 'hint' && b.hint !== undefined) {
      const hint = String(b.hint ?? '').trim();
      if (hint.length > 400) fields.hint = 'Keep the explanation under 400 characters.'; else out.extra = hint;
    }
    if (l.extra === 'stage' && (b.stage !== undefined || mode === 'create')) {
      if ((STAGES as readonly string[]).includes(String(b.stage))) out.extra = String(b.stage);
      else fields.stage = 'Say what reaching this status means.';
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  app.post('/api/security-incidents/lists/:name', guards.administer, async (req, reply) => {
    const l = which(req);
    const b = (req.body ?? {}) as Row;
    const data = parse(l, b, 'create');
    const value = slug(typeof b.value === 'string' && b.value.trim() ? b.value : data.label);
    if (!/^[a-z0-9][a-z0-9_]*$/.test(value)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { label: 'Use a name with letters or numbers in it.' });
    const clash = await db.one<Row>(`select active from lookups where list_key = $1 and (value = $2 or lower(label) = lower($3))`, [l.list, value, data.label]);
    if (clash) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', {
        label: clash.active ? 'That name is already in the list.' : 'That name was used before and is retired. Bring it back instead of adding it again.',
      });
    }
    const sort = data.sort ?? (await db.one<{ s: number }>(`select coalesce(max(sort), 0)::int + 10 as s from lookups where list_key = $1`, [l.list]))!.s;
    const row = (await db.one<Row>(
      `insert into lookups (list_key, value, label, color, sort, meta) values ($1,$2,$3,$4,$5,$6::jsonb) returning *`,
      [l.list, value, data.label, data.color ?? 'gray', sort, JSON.stringify(data.extra ? { [l.extra]: data.extra } : {})],
    ))!;
    await ctx.audit(req, { action: 'lookup.create', recordType: 'lookup', recordId: row.id, summary: `${l.noun} added: ${row.label}`, after: shape(row, l.extra) });
    reply.code(201);
    return shape(row, l.extra);
  });

  async function one(req: FastifyRequest, list: string): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`select * from lookups where id = $1 and list_key = $2`, [id, list]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Value not found.');
  }

  app.patch('/api/security-incidents/lists/:name/:id', guards.administer, async (req) => {
    const l = which(req);
    const before = await one(req, l.list);
    const data = parse(l, (req.body ?? {}) as Row, 'update');
    if (data.label && data.label.toLowerCase() !== String(before.label).toLowerCase()
      && await db.one(`select 1 from lookups where list_key = $1 and lower(label) = lower($2) and id <> $3`, [l.list, data.label, before.id])) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { label: 'That name is already in the list.' });
    }
    if (data.active === false && before.active) {
      const why = await inUse(String((req.params as Row).name), before.value);
      if (why) ctx.fail(409, 'in_use', why);
    }
    if (l.extra === 'stage') await checkStages({ id: before.id, stage: data.extra, active: data.active });
    const meta = data.extra !== undefined ? { ...(before.meta ?? {}), [l.extra]: data.extra } : before.meta ?? {};
    const row = (await db.one<Row>(
      `update lookups set label = $2, color = $3, sort = $4, active = $5, meta = $6::jsonb where id = $1 returning *`,
      [before.id, data.label ?? before.label, data.color ?? before.color, data.sort ?? before.sort, data.active ?? before.active, JSON.stringify(meta)],
    ))!;
    const was = shape(before, l.extra); const now = shape(row, l.extra);
    if (JSON.stringify(was) !== JSON.stringify(now)) {
      await ctx.audit(req, {
        action: row.active === before.active ? 'lookup.update' : row.active ? 'lookup.restore' : 'lookup.retire',
        recordType: 'lookup', recordId: row.id, summary: `${l.noun} changed: ${row.label}`, before: was, after: now,
      });
    }
    return now;
  });

  // "Remove" retires the value.
  app.delete('/api/security-incidents/lists/:name/:id', guards.administer, async (req) => {
    const l = which(req);
    const before = await one(req, l.list);
    if (!before.active) return { ok: true };
    const why = await inUse(String((req.params as Row).name), before.value);
    if (why) ctx.fail(409, 'in_use', why);
    if (l.extra === 'stage') await checkStages({ id: before.id, active: false });
    await db.query(`update lookups set active = false where id = $1`, [before.id]);
    await ctx.audit(req, { action: 'lookup.retire', recordType: 'lookup', recordId: before.id, summary: `${l.noun} retired: ${before.label}` });
    return { ok: true };
  });
}
