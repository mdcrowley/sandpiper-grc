import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { ANONYMIZED_TEXT } from '../../core/retention.ts';

/**
 * The investigation record of a safety event (E25-01, E25-04): the people involved, the timeline
 * and statements. People involved and statements name people and describe injuries, so their
 * routes need `security.view` as well as the safety permission, whether or not the event itself
 * is restricted; the timeline follows the event's own visibility. The event's fatalities and
 * people-taken-for-treatment counts follow the people involved once any are recorded (events.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Counts of the people involved in an event. */
export async function peopleCounts(ctx: Pick<ModuleContext, 'db'>, eventId: string): Promise<{ people: number; fatalities: number; transported: number }> {
  const r = await ctx.db.one<Row>(
    `select count(*)::int as people, count(*) filter (where fatality)::int as fatalities, count(*) filter (where transported)::int as transported
     from safety_event_people where event_id = $1`, [eventId]);
  return { people: r?.people ?? 0, fatalities: r?.fatalities ?? 0, transported: r?.transported ?? 0 };
}

/**
 * Removes the personal details an event's investigation record holds: names, notes and roster
 * links of the people involved, statements and who gave them, and the timeline's words and
 * authors. Counts, roles, injuries and dates stay. For anonymizing at the end of the retention
 * period: core's anonymizing covers the event's own fields, comments and files, not module
 * tables, so this is to be called with it (reported as a wave 11 item, GP-15).
 */
export async function anonymizeEventDetails(db: Queryable, eventId: string): Promise<{ people: number; statements: number; timeline: number }> {
  const people = (await db.query(
    `update safety_event_people set name = case when name is null then null else $2 end, notes = case when notes is null then null else $2 end,
       person_id = null, created_by = null, updated_by = null, updated_at = now() where event_id = $1 returning 1`, [eventId, ANONYMIZED_TEXT])).length;
  const statements = (await db.query(
    `update safety_event_statements set given_by = case when given_by is null then null else $2 end, text = $2,
       created_by = null, updated_by = null, updated_at = now() where event_id = $1 returning 1`, [eventId, ANONYMIZED_TEXT])).length;
  const timeline = (await db.query(
    `update safety_event_timeline set entry = $2, by_id = null, by_name = null, created_by = null where event_id = $1 returning 1`, [eventId, ANONYMIZED_TEXT])).length;
  return { people, statements, timeline };
}

interface ColSpec { label: string; type?: 'text' | 'longtext' | 'boolean' | 'date' | 'datetime' | 'lookup' | 'uuid'; list?: string; required?: boolean; max?: number }

export function registerEventDetail(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  type Pre = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  const pre = (...perms: string[]): { preHandler: Pre[] } => ({ preHandler: perms.map((p) => ctx.requirePerm(p)) });

  const eventFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('safety_event', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Safety event not found.');

  /** Checks a body against a column spec; `mode` create needs the required columns. */
  async function parse(spec: Record<string, ColSpec>, b: Row, mode: 'create' | 'update'): Promise<Row> {
    const out: Row = {};
    const errors: Record<string, string> = {};
    for (const [k, c] of Object.entries(spec)) {
      const v = b[k];
      if (v === undefined) { if (mode === 'create' && c.required) errors[k] = `${c.label} is required.`; continue; }
      const empty = v === null || v === '';
      if (empty) { if (c.required) errors[k] = `${c.label} is required.`; else out[k] = c.type === 'boolean' ? false : null; continue; }
      switch (c.type ?? 'text') {
        case 'boolean': out[k] = v === true; break;
        case 'date': {
          const s = String(v);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) errors[k] = 'Enter a date (YYYY-MM-DD).'; else out[k] = s;
          break;
        }
        case 'datetime': {
          const d = new Date(String(v));
          if (Number.isNaN(d.getTime())) errors[k] = 'Enter the date and time.';
          else if (d.getTime() > Date.now() + 5 * 60_000) errors[k] = 'The time cannot be in the future.';
          else out[k] = d.toISOString();
          break;
        }
        case 'lookup': {
          if (!(await ctx.lookups.values(c.list!)).some((x) => x.value === v)) errors[k] = `Choose a ${c.label.toLowerCase()}.`; else out[k] = String(v);
          break;
        }
        case 'uuid': {
          if (!UUID.test(String(v))) errors[k] = `Choose a ${c.label.toLowerCase()}.`; else out[k] = String(v);
          break;
        }
        default: {
          const s = String(v).trim();
          if (!s && c.required) errors[k] = `${c.label} is required.`;
          else out[k] = s.slice(0, c.max ?? (c.type === 'longtext' ? 20000 : 300)) || null;
        }
      }
    }
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  /** The counts on the event follow the people involved: saved through the resource engine, so reportability is worked out again. */
  async function syncCounts(req: FastifyRequest, event: Row) {
    const c = await peopleCounts(ctx, event.id);
    if (c.people === 0) return;
    if (Number(event.fatalities ?? -1) === c.fatalities && Number(event.people_transported ?? -1) === c.transported) return;
    await ctx.resources.update('safety_event', event.id, { fatalities: c.fatalities, people_transported: c.transported }, req);
  }

  /**
   * GET, POST, PATCH and DELETE for one table of rows on an event. `perms` are needed to read;
   * writing needs `safety.edit` in place of `safety.view`, with the rest kept.
   */
  function childRoutes(o: {
    seg: string; table: string; noun: string; spec: Record<string, ColSpec>; order: string; perms: string[];
    summary: string; describe: (r: Row) => string; prepare?: (req: FastifyRequest, data: Row, mode: 'create' | 'update') => Promise<Row>;
    after?: (req: FastifyRequest, event: Row) => Promise<void>; extraCols?: (req: FastifyRequest) => Row; locked?: (r: Row) => string | null;
  }) {
    const base = `/api/safety-events/:id/${o.seg}`;
    const one = `${base}/:childId`;
    const writePerms = o.perms.map((p) => (p === 'safety.view' ? 'safety.edit' : p));
    const childOf = async (req: FastifyRequest, event: Row): Promise<Row> => {
      const cid = String((req.params as Row).childId ?? '');
      const row = UUID.test(cid) ? await db.one<Row>(`select * from ${o.table} where id = $1 and event_id = $2`, [cid, event.id]) : undefined;
      return row ?? ctx.fail(404, 'not_found', `${o.noun} not found.`);
    };
    const also = o.perms.includes('security.view') ? ' (also needs security.view)' : '';

    app.get(base, pre(...o.perms), async (req) => {
      const event = await eventFor(req);
      return db.query<Row>(`select * from ${o.table} where event_id = $1 order by ${o.order}`, [event.id]);
    });
    ctx.describeRoute({ method: 'GET', path: base, permission: o.perms[0], summary: `${o.summary} of a safety event${also}` });

    app.post(base, pre(...writePerms), async (req, reply) => {
      const event = await eventFor(req);
      let data = await parse(o.spec, (req.body ?? {}) as Row, 'create');
      if (o.prepare) data = await o.prepare(req, data, 'create');
      const extra = o.extraCols?.(req) ?? {};
      const cols: Row = { ...data, ...extra, event_id: event.id, created_by: actorOf(req).id };
      const keys = Object.keys(cols);
      const row = (await db.one<Row>(
        `insert into ${o.table} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, keys.map((k) => cols[k])))!;
      await ctx.audit(req, { action: `safety_event.${o.seg}_add`, recordType: 'safety_event', recordId: event.id, summary: `${o.noun} added: ${o.describe(row)}`, after: { id: row.id } });
      await o.after?.(req, event);
      reply.code(201);
      return row;
    });
    ctx.describeRoute({ method: 'POST', path: base, permission: writePerms[0], summary: `Add to the ${o.summary.toLowerCase()} of a safety event${also}`, body: `{ ${Object.keys(o.spec).join(', ')} }` });

    app.patch(one, pre(...writePerms), async (req) => {
      const event = await eventFor(req);
      const before = await childOf(req, event);
      const lock = o.locked?.(before);
      if (lock) ctx.fail(409, 'locked', lock);
      let data = await parse(o.spec, (req.body ?? {}) as Row, 'update');
      if (o.prepare) data = await o.prepare(req, data, 'update');
      const keys = Object.keys(data);
      if (!keys.length) return before;
      const hasUpdated = o.table !== 'safety_event_timeline';
      const row = (await db.one<Row>(
        `update ${o.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}${hasUpdated ? `, updated_at = now(), updated_by = $${keys.length + 2}` : ''} where id = $1 returning *`,
        [before.id, ...keys.map((k) => data[k]), ...(hasUpdated ? [req.user!.id] : [])]))!;
      // The history says what changed, not the words: they stay with the record, which may be restricted.
      await ctx.audit(req, { action: `safety_event.${o.seg}_update`, recordType: 'safety_event', recordId: event.id, summary: `${o.noun} changed: ${o.describe(row)} (${keys.join(', ')})`, after: { id: row.id, changed: keys } });
      await o.after?.(req, event);
      return row;
    });
    ctx.describeRoute({ method: 'PATCH', path: one, permission: writePerms[0], summary: `Change one entry of the ${o.summary.toLowerCase()} of a safety event${also}` });

    app.delete(one, pre(...writePerms), async (req) => {
      const event = await eventFor(req);
      const before = await childOf(req, event);
      const lock = o.locked?.(before);
      if (lock) ctx.fail(409, 'locked', lock);
      await db.query(`delete from ${o.table} where id = $1`, [before.id]);
      await ctx.audit(req, { action: `safety_event.${o.seg}_remove`, recordType: 'safety_event', recordId: event.id, summary: `${o.noun} removed: ${o.describe(before)}`, before: { id: before.id } });
      await o.after?.(req, event);
      return { ok: true };
    });
    ctx.describeRoute({ method: 'DELETE', path: one, permission: writePerms[0], summary: `Remove one entry of the ${o.summary.toLowerCase()} of a safety event${also}` });
  }

  const roleLabel = (r: Row) => String(r.role ?? '').replace(/_/g, ' ');

  childRoutes({
    seg: 'people', table: 'safety_event_people', noun: 'Person involved', summary: 'People involved', order: 'created_at',
    perms: ['safety.view', 'security.view'],
    spec: {
      role: { label: 'Role', type: 'lookup', list: 'safety_person_role', required: true },
      person_id: { label: 'Person on the staff roster', type: 'uuid' },
      name: { label: 'Name', max: 200 },
      injury_severity: { label: 'Injury', type: 'lookup', list: 'safety_injury_severity' },
      transported: { label: 'Taken for medical treatment', type: 'boolean' },
      fatality: { label: 'Fatality', type: 'boolean' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    // The audit entry names the role only: names stay with the restricted record.
    describe: (r) => `${roleLabel(r)}${r.fatality ? ', fatality' : r.transported ? ', taken for treatment' : ''}`,
    async prepare(req, data) {
      // The staff roster (contract C4) is optional: a link is kept only when the roster is there and the person is on it.
      if (data.person_id) {
        if (!ctx.resources.get('person')) data.person_id = null;
        else if (!(await ctx.resources.find('person', data.person_id, req.user))) invalid({ person_id: 'That person is not on the staff roster.' });
      }
      return data;
    },
    after: async (req, event) => syncCounts(req, (await ctx.resources.find('safety_event', event.id, null)) ?? event),
  });

  childRoutes({
    seg: 'timeline', table: 'safety_event_timeline', noun: 'Timeline entry', summary: 'Investigation timeline', order: 'at, created_at',
    perms: ['safety.view'],
    spec: { at: { label: 'Time', type: 'datetime', required: true }, entry: { label: 'Entry', type: 'longtext', required: true, max: 4000 } },
    describe: (r) => new Date(r.at).toISOString(),
    extraCols: (req) => ({ by_id: actorOf(req).id, by_name: actorOf(req).name }),
    // Entries the application wrote (reporting rules, clocks, alerts) are the record of what happened: they stay as written.
    locked: (r) => (r.by_id ? null : 'This entry was written by the application and cannot be changed.'),
  });

  childRoutes({
    seg: 'statements', table: 'safety_event_statements', noun: 'Statement', summary: 'Statements', order: 'given_on nulls last, created_at',
    perms: ['safety.view', 'security.view'],
    spec: {
      statement_type: { label: 'Kind of statement', type: 'lookup', list: 'safety_statement_type', required: true },
      given_by: { label: 'Given by', max: 200 },
      given_on: { label: 'Given on', type: 'date' },
      text: { label: 'Statement', type: 'longtext', required: true },
    },
    describe: (r) => `${String(r.statement_type ?? '').replace(/_/g, ' ')}${r.given_on ? `, ${r.given_on}` : ''}`,
  });
}
