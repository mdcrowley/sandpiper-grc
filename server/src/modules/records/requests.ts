// Records and personal-data requests (E34-03, E34-04, E34-07): one request type with a due clock,
// responsive records with an exemption each, extension with a reason, preservation under a legal
// hold, and closing with a response summary. Personal-data kinds (list meta.personal) are seen only
// by people who also hold privacy.view; figures count every request.
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleContext, Row, RowRule, SessionUser } from '../../core/module.ts';
import { actorOf } from '../../core/dataload.ts';
import { ANONYMIZED_TEXT, onAnonymize } from '../../core/retention.ts';
import { todayInZone } from '../../core/timezone.ts';
import { byUrgency, clockOf } from '../secincidents/clocks.ts';
import { placeHold } from '../holds/service.ts';
import { addDays, dueDateFor, readSettings, type RecordsSettings } from './settings.ts';

export const REQUEST_TYPE = 'records_request';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown) => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
/** Statuses that stop the clock. */
export const FINAL = ['responded', 'closed', 'withdrawn', 'refused'];
const PERSONAL_KINDS = `(select l_.value from lookups l_ where l_.list_key = 'records_request_kind' and coalesce((l_.meta->>'personal')::boolean, false))`;
const literalList = (xs: string[]) => xs.map((x) => `'${x}'`).join(', ');

/** The request's row rule: personal-data kinds need privacy.view as well. Figures keep counting them. */
export function requestRule(ctx: ModuleContext): RowRule {
  return {
    where: (user, col) => (ctx.can(user, 'privacy.view') ? 'true' : `${col('kind')} not in ${PERSONAL_KINDS}`),
    figures: 'mask',
    hidden: (col) => `${col('kind')} in ${PERSONAL_KINDS}`,
  };
}

/** The date the request is due now: the extended date when there is one. */
export const effectiveDue = (r: Row): string | null => {
  const d = r.extended_due_on ?? r.due_on;
  return d ? String(d).slice(0, 10) : null;
};

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * The clock of one request, in whole days in the organization's time zone (`clockOf` from the
 * incident clocks): red once the due day has passed, amber when the amber fraction (or less) of the
 * time from receipt to the due date remains, met (late when answered after the due date) once it stops.
 */
export function requestClock(r: Row, s: RecordsSettings, today = todayInZone()): Row {
  const due = effectiveDue(r);
  const received = String(r.received_on ?? '').slice(0, 10);
  const stopped = FINAL.includes(String(r.status));
  const answered = String(r.responded_on ?? r.closed_on ?? '').slice(0, 10);
  const task = {
    id: r.id, ref: r.ref, status: stopped ? 'done' : 'open', deadline_hours: null,
    due_at: due ? new Date(`${addDays(due, 1, false)}T00:00:00Z`).toISOString() : null,
    notified_at: stopped && answered ? noon(answered).toISOString() : null,
  };
  const c = clockOf(task, `${received}T00:00:00Z`, noon(today), s.amberFraction);
  const days = due ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  return {
    request_id: r.id, ref: r.ref, subject: r.subject, kind: r.kind, status: r.status, owner_id: r.owner_id ?? null,
    received_on: received || null, due_on: due, extended: Boolean(r.extended_due_on), state: c.state, late: c.late, overdue: c.overdue,
    days_left: stopped ? null : days, amber_on: c.amber_at ? String(c.amber_at).slice(0, 10) : null,
    due_at: c.due_at,
  };
}

export async function registerRequests(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function checkRequest(req: FastifyRequest | null, merged: Row, patch: Row, existing: Row | null): Promise<Row> {
    if ('received_on' in patch && patch.received_on && String(patch.received_on) > todayInZone()) invalid({ received_on: 'A request cannot be received in the future.' });
    // The due date follows the kind and the day received, until it is extended (then it stays as it was).
    if (!existing || (('kind' in patch || 'received_on' in patch) && !existing.extended_due_on)) {
      if (merged.kind && merged.received_on) patch.due_on = dueDateFor(await readSettings(ctx), String(merged.kind), String(merged.received_on).slice(0, 10));
    }
    if ('status' in patch && existing && patch.status !== existing.status) {
      if (['responded', 'closed'].includes(String(patch.status)) && !String(merged.response_summary ?? '').trim()) {
        invalid({ response_summary: 'Summarize the response before the request is closed.' });
      }
      if (patch.status === 'responded' && !merged.responded_on) patch.responded_on = todayInZone();
      if (FINAL.includes(String(patch.status)) && patch.status !== 'responded' && !merged.closed_on) patch.closed_on = todayInZone();
      if (!FINAL.includes(String(patch.status))) { patch.closed_on = null; }
    }
    return patch;
  }

  ctx.defineResource({
    type: REQUEST_TYPE, table: 'records_requests', module: 'records', label: 'Records request', plural: 'Records requests',
    path: '/api/records-requests', route: '/records-requests', titleField: 'subject',
    ref: { field: 'ref', prefix: 'RRQ-' },
    searchable: ['subject', 'description'],
    // Open requests by the date due now, so the overdue ones come first; answered ones after (E18-83).
    defaultSort: { field: 'open_due_on', dir: 'asc' },
    rowRule: requestRule(ctx),
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      subject: { label: 'Subject', type: 'text', required: true, personal: false },
      kind: { label: 'Kind', type: 'lookup', list: 'records_request_kind', required: true, default: 'records' },
      status: { label: 'Status', type: 'lookup', list: 'records_request_status', default: 'received' },
      requester_name: { label: 'Requester', type: 'text', personal: true },
      requester_contact: { label: 'Requester contact', type: 'text', personal: true },
      requester_address: { label: 'Requester address', type: 'longtext', personal: true },
      identity_verified: { label: 'Identity verified', type: 'boolean', default: false },
      received_on: { label: 'Received on', type: 'date' }, // today when left empty (hook)
      due_on: { label: 'First due', type: 'date', readOnly: true },
      extended_due_on: { label: 'Extended to', type: 'date', readOnly: true },
      // E18-83: the date due now (the extended one when there is one), worked out by the database.
      current_due_on: { label: 'Due', type: 'date', readOnly: true },
      extension_reason: { label: 'Reason for extension', type: 'longtext', readOnly: true },
      description: { label: 'What was asked for', type: 'longtext' },
      owner_id: { label: 'Owner', type: 'user' },
      responded_on: { label: 'Responded on', type: 'date' },
      closed_on: { label: 'Closed on', type: 'date', readOnly: true },
      response_summary: { label: 'Response summary', type: 'longtext' },
      fee: { label: 'Fee', type: 'currency' },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        data.received_on ??= todayInZone();
        return checkRequest(req, data, data, null);
      },
      beforeUpdate: async (req, existing, patch) => checkRequest(req, { ...existing, ...patch }, patch, existing),
    },
  });

  // Anonymizing a request (end of retention) also blanks the notes on its responsive records (E34).
  onAnonymize(REQUEST_TYPE, async (tx, id) => {
    await tx.query(`update records_request_items set note = case when note is null then null else $2 end, updated_at = now() where request_id = $1`, [id, ANONYMIZED_TEXT]);
  });

  const requestFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(REQUEST_TYPE, String((req.params as { id: string }).id), req.user)) ?? ctx.fail(404, 'not_found', 'Request not found.');

  // ---------------------------------------------------------------- responsive records

  async function listItems(requestId: string, user: SessionUser | null | undefined): Promise<{ rows: Row[]; total: number; hidden: number }> {
    const items = await db.query<Row>(
      `select i.id, i.record_type, i.record_id::text as record_id, i.exemption, i.disclosed, i.note, i.created_at, u.display_name as added_by_name
       from records_request_items i left join users u on u.id = i.added_by where i.request_id = $1 order by i.created_at, i.id`, [requestId]);
    const rows: Row[] = [];
    for (const type of new Set(items.map((i) => i.record_type))) {
      const def = ctx.resources.get(type);
      if (!def || !ctx.can(user ?? null, `${def.module}.view`) || (def.restricted === true && !ctx.can(user ?? null, 'security.view'))) continue;
      const mine = items.filter((i) => i.record_type === type);
      const found = new Map((await db.query<Row>(
        `select id::text as id, ${def.titleField}::text as label, ${def.ref ? `${def.ref.field}::text` : 'null'} as ref from ${def.table}
         where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(type, user ?? null)}`, [mine.map((i) => i.record_id)])).map((r) => [r.id, r]));
      for (const i of mine) {
        const rec = found.get(i.record_id);
        if (rec) rows.push({ ...i, typeLabel: def.label, label: rec.label, ref: rec.ref, route: `${def.route}/${i.record_id}` });
      }
    }
    const order = new Map(items.map((i, n) => [i.id, n]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { rows, total: items.length, hidden: items.length - rows.length };
  }

  const lookupValue = async (list: string, v: unknown, label: string, errors: Record<string, string>, key: string) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (!(await ctx.lookups.values(list)).some((x) => x.value === String(v))) errors[key] = `${label}: choose from the list.`;
    return String(v);
  };

  app.get('/api/records-requests/:id/items', { preHandler: ctx.requirePerm('records.view') }, async (req) => listItems((await requestFor(req)).id, req.user));
  ctx.describeRoute({
    method: 'GET', path: '/api/records-requests/:id/items', tag: 'Records requests', permission: 'records.view',
    summary: 'The responsive records of a request that you may see, with their exemption and disclosure; total counts them all',
    response: '{ rows: [{ id, record_type, typeLabel, record_id, label, ref, route, exemption, disclosed, note, added_by_name, created_at }], total, hidden }',
  });

  app.post('/api/records-requests/:id/items', { preHandler: ctx.requirePerm('records.edit') }, async (req, reply) => {
    const request = await requestFor(req);
    const b = (req.body ?? {}) as Row;
    const type = String(b.record_type ?? '');
    const id = String(b.record_id ?? '');
    const def = ctx.resources.get(type);
    // Only a record the person can see may be linked (E34-04).
    if (!def || type === REQUEST_TYPE || !UUID_RE.test(id) || !(await ctx.resources.find(type, id, req.user))) invalid({ record_id: 'Choose a record you can see.' });
    const errors: Record<string, string> = {};
    const exemption = await lookupValue('records_exemption', b.exemption, 'Exemption', errors, 'exemption');
    const disclosed = await lookupValue('records_disclosure', b.disclosed, 'Disclosed', errors, 'disclosed');
    if (Object.keys(errors).length) invalid(errors);
    const row = await db.one<Row>(
      `insert into records_request_items (request_id, record_type, record_id, exemption, disclosed, note, added_by) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (request_id, record_type, record_id) do nothing returning id`,
      [request.id, type, id, exemption ?? null, disclosed ?? null, String(b.note ?? '').trim().slice(0, 2000) || null, actorOf(req).id]);
    if (!row) ctx.fail(409, 'duplicate', 'That record is already listed on this request.');
    // Mirrored as a link so the record's Related tab shows the request (contract C7).
    await db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1,$2,$3,$4,'responsive_to',$5) on conflict do nothing`,
      [type, id, REQUEST_TYPE, request.id, actorOf(req).id]);
    await ctx.audit(req, {
      action: 'records_request.item_add', recordType: REQUEST_TYPE, recordId: request.id,
      summary: `Responsive record added: ${def!.label} ${(await ctx.resources.labelFor(type, id)) ?? id}`, after: { record_type: type, record_id: id, exemption, disclosed },
    });
    reply.code(201);
    return (await listItems(request.id, req.user)).rows.find((r) => r.id === row!.id) ?? { id: row!.id };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-requests/:id/items', tag: 'Records requests', permission: 'records.edit',
    summary: 'Add a responsive record you can see to a request (also shown on the record as "responsive to")',
    body: '{ record_type, record_id, exemption?, disclosed?: "full" | "partial" | "withheld", note? }',
  });

  const itemFor = async (req: FastifyRequest, requestId: string): Promise<Row> => {
    const itemId = String((req.params as { itemId: string }).itemId ?? '');
    const item = UUID_RE.test(itemId) ? await db.one<Row>('select * from records_request_items where id = $1 and request_id = $2', [itemId, requestId]) : undefined;
    // An item about a record the person cannot see is not theirs to change.
    if (!item || !(await ctx.resources.find(item.record_type, item.record_id, req.user))) ctx.fail(404, 'not_found', 'Responsive record not found.');
    return item!;
  };

  app.patch('/api/records-requests/:id/items/:itemId', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const request = await requestFor(req);
    const item = await itemFor(req, request.id);
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const patch: Row = {};
    const exemption = await lookupValue('records_exemption', b.exemption, 'Exemption', errors, 'exemption');
    if (exemption !== undefined) patch.exemption = exemption;
    const disclosed = await lookupValue('records_disclosure', b.disclosed, 'Disclosed', errors, 'disclosed');
    if (disclosed !== undefined) patch.disclosed = disclosed;
    if (b.note !== undefined) patch.note = String(b.note ?? '').trim().slice(0, 2000) || null;
    if (Object.keys(errors).length) invalid(errors);
    const keys = Object.keys(patch);
    if (keys.length) {
      await db.query(`update records_request_items set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [item.id, ...keys.map((k) => patch[k])]);
      await ctx.audit(req, {
        action: 'records_request.item_change', recordType: REQUEST_TYPE, recordId: request.id,
        summary: 'Responsive record changed (exemption, disclosure or note)', before: Object.fromEntries(keys.map((k) => [k, item[k]])), after: patch,
      });
    }
    return (await listItems(request.id, req.user)).rows.find((r) => r.id === item.id);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/records-requests/:id/items/:itemId', tag: 'Records requests', permission: 'records.edit',
    summary: 'Change a responsive record\'s exemption, disclosure or note', body: '{ exemption?, disclosed?, note? }',
  });

  app.delete('/api/records-requests/:id/items/:itemId', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const request = await requestFor(req);
    const item = await itemFor(req, request.id);
    await db.query('delete from records_request_items where id = $1', [item.id]);
    await db.query(`delete from record_links where from_type = $1 and from_id = $2 and to_type = $3 and to_id = $4 and relation = 'responsive_to'`,
      [item.record_type, item.record_id, REQUEST_TYPE, request.id]);
    await ctx.audit(req, {
      action: 'records_request.item_remove', recordType: REQUEST_TYPE, recordId: request.id,
      summary: `Responsive record removed: ${(await ctx.resources.labelFor(item.record_type, item.record_id)) ?? item.record_id}`, before: item,
    });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/records-requests/:id/items/:itemId', tag: 'Records requests', permission: 'records.edit', summary: 'Remove a responsive record from a request' });

  // ---------------------------------------------------------------- extend, preserve, close

  app.post('/api/records-requests/:id/extend', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const request = await requestFor(req);
    if (FINAL.includes(String(request.status))) ctx.fail(409, 'closed', 'This request is closed; its deadline cannot change.');
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 5 || reason.length > 2000) errors.reason = 'Say why the deadline is extended (5 to 2000 characters).';
    const until = b.until ? String(b.until) : Number.isInteger(Number(b.days)) && Number(b.days) > 0 && Number(b.days) <= 365
      ? await (async () => { const st = await readSettings(ctx); return addDays(effectiveDue(request) ?? todayInZone(), Number(b.days), st.businessDays, st.calendar); })() : '';
    if (!isDate(until)) errors.until = 'Give the new due date (YYYY-MM-DD) or a number of days.';
    else if (until <= (effectiveDue(request) ?? '')) errors.until = 'The new due date must be after the current one.';
    if (Object.keys(errors).length) invalid(errors);
    // System work: the new date is read-only to forms. The clock alerts start again for the new date.
    await ctx.resources.update(REQUEST_TYPE, request.id, { extended_due_on: until, extension_reason: reason }, null);
    await db.query('update records_requests set alerted_amber_at = null, alerted_red_at = null where id = $1', [request.id]);
    await ctx.audit(req, {
      action: 'records_request.extend', recordType: REQUEST_TYPE, recordId: request.id,
      summary: `Deadline of ${request.ref} extended from ${effectiveDue(request)} to ${until}: ${reason}`,
      before: { due: effectiveDue(request) }, after: { extended_due_on: until, extension_reason: reason },
    });
    return ctx.resources.find(REQUEST_TYPE, request.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-requests/:id/extend', tag: 'Records requests', permission: 'records.edit',
    summary: 'Extend a request\'s deadline (needs a reason; audited); its clock alerts start again', body: '{ reason, until?: date, days?: number }',
  });

  app.post('/api/records-requests/:id/preserve', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const request = await requestFor(req);
    if (!ctx.can(req.user, 'legal.edit')) ctx.fail(403, 'forbidden', 'Placing records under a legal hold needs permission to edit legal holds.');
    if (!ctx.resources.get('legal_hold')) ctx.fail(409, 'holds_unavailable', 'Legal holds are not part of this installation.');
    const b = (req.body ?? {}) as Row;
    const items = (await listItems(request.id, req.user)).rows;
    if (!items.length) ctx.fail(409, 'no_records', 'Add the responsive records first.');
    const result = await placeHold(ctx, {
      holdId: b.hold_id ? String(b.hold_id) : undefined,
      matter: b.hold_id ? undefined : String(b.matter ?? `Preservation for records request ${request.ref}`),
      records: items.map((i) => ({ type: i.record_type, id: i.record_id })),
    }, req);
    await ctx.audit(req, {
      action: 'records_request.preserve', recordType: REQUEST_TYPE, recordId: request.id,
      summary: `${result.added} responsive record${result.added === 1 ? '' : 's'} placed under legal hold ${result.ref}`,
    });
    return result;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-requests/:id/preserve', tag: 'Records requests', permission: 'records.edit',
    summary: 'Preserve a request\'s responsive records (those you can see) under a legal hold: an existing one, or a new one for the matter given (also needs legal.edit)',
    body: '{ hold_id? , matter? }', response: '{ holdId, ref, added }',
  });

  app.post('/api/records-requests/:id/close', { preHandler: ctx.requirePerm('records.edit') }, async (req) => {
    const request = await requestFor(req);
    const b = (req.body ?? {}) as Row;
    const summary = String(b.response_summary ?? request.response_summary ?? '').trim();
    const status = b.status === undefined ? 'closed' : String(b.status);
    if (!['closed', 'responded', 'withdrawn', 'refused'].includes(status)) invalid({ status: 'Close as responded, closed, withdrawn or refused.' });
    if (!summary) invalid({ response_summary: 'Summarize the response before the request is closed.' });
    const patch: Row = { status, response_summary: summary };
    if (b.responded_on !== undefined) patch.responded_on = b.responded_on;
    return ctx.resources.update(REQUEST_TYPE, request.id, patch, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/records-requests/:id/close', tag: 'Records requests', permission: 'records.edit',
    summary: 'Close a request with its response summary (status closed, responded, withdrawn or refused)',
    body: '{ response_summary, status?, responded_on? }',
  });

  // ---------------------------------------------------------------- clocks

  const openRequests = async (user: SessionUser | null | undefined) => db.query<Row>(
    `select * from records_requests where deleted_at is null and status not in (${literalList(FINAL)})
       and ${ctx.resources.visibleWhere(REQUEST_TYPE, user ?? null)} order by coalesce(extended_due_on, due_on) nulls last limit 1000`);

  app.get('/api/records/clocks', { preHandler: ctx.requirePerm('records.view') }, async (req) => {
    const s = await readSettings(ctx);
    return (await openRequests(req.user)).map((r) => requestClock(r, s)).sort(byUrgency);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/records/clocks', tag: 'Records requests', permission: 'records.view',
    summary: 'The clocks of the open requests you may see, most urgent first',
    response: '[{ request_id, ref, subject, kind, status, owner_id, received_on, due_on, extended, state: "green" | "amber" | "red", days_left, amber_on }]',
  });

  app.get('/api/records-requests/:id/clock', { preHandler: ctx.requirePerm('records.view') }, async (req) => {
    const request = await requestFor(req);
    return { ...requestClock(request, await readSettings(ctx)), extension_reason: request.extension_reason ?? null, original_due_on: request.due_on ?? null };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/records-requests/:id/clock', tag: 'Records requests', permission: 'records.view',
    summary: 'One request\'s clock: due date (extended or not), state and days left',
  });

  /** Tells each open request's owner once when its clock turns amber and once when it turns red (claimed first). */
  async function runClocks(today = todayInZone()): Promise<{ amber: number; red: number }> {
    const s = await readSettings(ctx);
    const out = { amber: 0, red: 0 };
    const rows = await db.query<Row>(
      `select * from records_requests where deleted_at is null and status not in (${literalList(FINAL)})
         and (alerted_amber_at is null or alerted_red_at is null) limit 2000`);
    for (const r of rows) {
      const c = requestClock(r, s, today);
      for (const state of ['red', 'amber'] as const) {
        if (c.state !== state) continue;
        const column = state === 'red' ? 'alerted_red_at' : 'alerted_amber_at';
        // Claimed in one statement before anyone is told, so two runs at once send it once.
        const claimed = await db.one(`update records_requests set ${column} = now() where id = $1 and ${column} is null returning id`, [r.id]);
        if (!claimed) continue;
        if (state === 'red') await db.query('update records_requests set alerted_amber_at = coalesce(alerted_amber_at, now()) where id = $1', [r.id]);
        out[state] += 1;
        if (!app.hasDecorator('notify')) continue;
        await app.notify({
          ...(r.owner_id ? { userIds: [r.owner_id] } : { permission: 'records.edit' }), kind: 'records',
          title: state === 'red' ? `Request overdue: ${r.ref} was due on ${c.due_on}` : `Request due soon: ${r.ref} is due on ${c.due_on}`,
          body: state === 'red' ? 'Respond, or extend the deadline with a reason.' : `${c.days_left} day${c.days_left === 1 ? '' : 's'} left to respond.`,
          recordType: REQUEST_TYPE, recordId: r.id,
        });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- summary (contract C5)

  app.get('/api/records/summary', { preHandler: ctx.requirePerm('records.view') }, async (req) => {
    const s = await readSettings(ctx);
    // A figure: every open request counts, whoever asks (no names, no requester details).
    const open = await db.query<Row>(`select id, ref, kind, status, received_on, due_on, extended_due_on from records_requests where deleted_at is null and status not in (${literalList(FINAL)})`);
    const clocks = open.map((r) => requestClock(r, s));
    const byKind: Record<string, number> = {};
    for (const r of open) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    const holds = ctx.can(req.user, 'legal.view')
      ? (await db.one<{ n: number }>(`select count(*)::int n from legal_holds where status = 'active' and deleted_at is null`))!.n : undefined;
    return {
      requests: { open: open.length, due_soon: clocks.filter((c) => c.state === 'amber').length, overdue: clocks.filter((c) => c.state === 'red').length, by_kind: byKind },
      ...(holds === undefined ? {} : { holds_active: holds }),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/records/summary', tag: 'Records requests', permission: 'records.view',
    summary: 'Figures only: open requests, due soon, overdue and by kind; active legal holds for people holding legal.view',
    response: '{ requests: { open, due_soon, overdue, by_kind: { [kind]: n } }, holds_active? }',
  });

  // ---------------------------------------------------------------- metric and calendar

  defineMetric(app, {
    key: 'records.requests_overdue', label: 'Records requests overdue', unit: 'count', recordType: REQUEST_TYPE,
    description: 'Requests not yet answered at the end of the month whose due date (extended or not) had passed.',
    compute: async (_ctx, monthStart) => {
      const end = new Date(`${monthStart}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const last = addDays(end.toISOString().slice(0, 10), -1, false);
      return (await db.one<{ n: number }>(
        `select count(*)::int n from records_requests where deleted_at is null and received_on <= $1::date
           and coalesce(extended_due_on, due_on) < $1::date
           and (coalesce(responded_on, closed_on) is null or coalesce(responded_on, closed_on) > $1::date)`,
        [last]))!.n;
    },
  });

  defineCalendarSource(app, {
    key: 'records.requests_due', label: 'Records requests I own, by due date', recordType: REQUEST_TYPE, permission: 'records.view',
    work: true, kind: 'Records requests', // E41-03: My work
    events: async (_ctx, user, from, to) => {
      const rows = await db.query<Row>(
        `select id, ref, subject, coalesce(extended_due_on, due_on)::text as due from records_requests
         where deleted_at is null and owner_id = $1 and status not in (${literalList(FINAL)})
           and coalesce(extended_due_on, due_on) between $2::date and $3::date and ${ctx.resources.visibleWhere(REQUEST_TYPE, user)}
         order by 4`, [user.id, from, to]);
      return rows.map((r) => ({
        uid: `records.requests_due:${r.id}`, title: `Request due: ${r.ref} ${r.subject}`, start: r.due, allDay: true,
        url: `/records-requests/${r.id}`, recordType: REQUEST_TYPE, recordId: r.id,
      }));
    },
  });

  return { runClocks };
}
