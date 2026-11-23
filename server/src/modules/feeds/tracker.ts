// Two-way work-tracker bridge (E36-06): records (actions, and vulnerabilities while that area is on) sent
// to an outside work-tracking tool as signed JSON, and the tool's status brought back. Generic: no
// product is named or assumed. The tables keep their first names (ticket_connectors,
// external_ticket_links, ticket_inbound_signatures), as do the sealing contexts of the secrets.
// Kinds of record whose area is switched off are neither offered, accepted nor sent; a connection keeps
// them stored, and they come back when the area is switched on.
//
// - Off until an administrator adds a connector and switches it on; sending also needs outbound
//   connections on (`integrations.outbound_enabled`) and the connector's host on the allow-list
//   (`integrations.allowed_hosts`), checked again at connection time by `postWebhook` (core/webhooks.ts,
//   which refuses private addresses not listed exactly).
// - Outbound: "Send to work tracker" on a record (needs edit on it), or automatically on create when the
//   connector says so. The request is queued on `external_ticket_links`; the job `feeds.tracker_push`
//   claims each one in a single statement before posting it, so overlapping runs send it once. The body
//   is signed like a webhook (`X-GRC-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`). A
//   restricted record is never sent unless the connector includes restricted records, which only a
//   holder of `security.view` can set.
// - Inbound: `POST /api/integrations/tracker/:connectorId/status` (public) carries
//   `{ link_id | external_id, external_url?, status }`, signed with the connector's inbound secret over
//   the timestamp and the raw body. A stale timestamp (over 5 minutes), a bad signature, a copy already
//   accepted (every one is remembered for 10 minutes; a connection with 10,000 inside that time takes no more until older ones age out), an unknown or switched-off connector: all get
//   the same 401. The outside status is kept on the link; when the connector's status map names one of
//   ours, the record moves to it as system work, after the type's lifecycle check for the person who
//   sent it (a move that would wait for approval, or that they may no longer make, is not made).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { loadUser, secretBox } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import { featureState, typeOff } from '../../core/features.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { hostAllowed, postWebhook, signWebhook } from '../../core/webhooks.ts';
import { sensitive } from '../admin/shared.ts';
import { appBase } from './calendar.ts';
import { rememberSignature } from './replay.ts';

/** The kinds of record the bridge can carry; those of a switched-off area are left out where used. */
export const TRACKER_TYPES = ['action', 'vulnerability'] as const;
const URL_CONTEXT = (id: string) => `ticket-connector-url:${id}`;
const SECRET_CONTEXT = (id: string) => `ticket-connector-secret:${id}`;
const INBOUND_CONTEXT = (id: string) => `ticket-connector-inbound:${id}`;
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
};
const newSecret = () => randomBytes(32).toString('base64url');

/** A connector as administrators see it: the host, never the address or the secrets. */
function presentConnector(r: Row) {
  return {
    id: r.id, name: r.name, url_host: r.url_host, active: r.active, record_types: json<string[]>(r.record_types, []),
    push_on_create: r.push_on_create, include_restricted: r.include_restricted, status_map: json<Row>(r.status_map, {}),
    last_inbound_at: r.last_inbound_at ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** Whether a record is restricted (whole type, or the row's flag). */
const isRestricted = (def: ResourceDef, row: Row) => def.restricted === true || (def.restricted === 'flag' && row.restricted === true);

export async function registerTracker(ctx: ModuleContext) {
  const { app, db } = ctx;
  const box = () => secretBox(db);
  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  const inboundLimiter = makeDbLimiter(db, 'tracker_inbound', 300, 60_000);

  /** The kinds of record the bridge carries now: present and of an area that is on. */
  async function kindsOn(): Promise<ResourceDef[]> {
    const state = await featureState(db);
    return TRACKER_TYPES.map((t) => ctx.resources.get(t)).filter((d): d is ResourceDef => !!d && !typeOff(state, d));
  }
  const kindOn = async (type: unknown) => (await kindsOn()).find((d) => d.type === type);

  // ---------- administration ----------

  async function checkConnector(req: FastifyRequest, b: Row, existing: Row | null) {
    // A kind already stored stays acceptable while its area is off, so saving keeps it.
    const allowed = new Set([...(await kindsOn()).map((d) => d.type), ...json<string[]>(existing?.record_types, [])]);
    const fields: Record<string, string> = {};
    const out: Row = {};
    if (!existing || b.name !== undefined) {
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      if (!name || name.length > 100) fields.name = 'Give the connection a name of up to 100 characters.';
      else out.name = name;
    }
    if (!existing || b.url !== undefined) {
      let u: URL | null = null;
      try { u = new URL(String(b.url ?? '')); } catch { /* below */ }
      if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || String(b.url).length > 1000) {
        fields.url = 'Enter the full https:// address the work tracker receives on, without a user name or password.';
      } else out.url = u.toString();
    }
    if (!existing || b.record_types !== undefined) {
      const types = Array.isArray(b.record_types) ? [...new Set(b.record_types.map(String))] : [];
      if (!types.length || types.some((t) => !allowed.has(t))) fields.record_types = 'Choose at least one kind of record from those offered.';
      else out.record_types = types;
    }
    for (const k of ['active', 'push_on_create', 'include_restricted'] as const) {
      if (b[k] === undefined) continue;
      if (typeof b[k] !== 'boolean') fields[k] = 'Choose yes or no.';
      else out[k] = b[k];
    }
    if (out.include_restricted === true && !ctx.can(req.user, 'security.view')) {
      fields.include_restricted = 'Only someone who may see restricted records can send them to a work tracker.';
    }
    if (b.status_map !== undefined) {
      const map = b.status_map;
      const ok = map && typeof map === 'object' && !Array.isArray(map) && Object.entries(map).every(([type, m]) =>
        (TRACKER_TYPES as readonly string[]).includes(type) && m && typeof m === 'object' && !Array.isArray(m)
        && Object.entries(m as Row).every(([k, v]) => k.length <= 100 && typeof v === 'string' && v.length <= 60));
      if (!ok) fields.status_map = 'Map each outside status to one of ours, per kind of record: { "action": { "Resolved": "done" } }.';
      else out.status_map = map;
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return out;
  }

  async function connectorOf(id: string): Promise<Row> {
    const row = UUID_RE.test(id) ? await db.one<Row>('select * from ticket_connectors where id = $1 and deleted_at is null', [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Connection not found.');
  }

  app.get('/api/admin/tracker-connectors', admin, async () => {
    const rows = await db.query<Row>('select * from ticket_connectors where deleted_at is null order by name');
    const counts = await db.query<Row>(
      `select connector_id, count(*) filter (where pushed_at is not null)::int as links, count(*) filter (where pushed_at is null and push_error is not null)::int as failing
         from external_ticket_links group by connector_id`);
    const byId = new Map(counts.map((c) => [c.connector_id, c]));
    return {
      outboundEnabled: (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true,
      kinds: (await kindsOn()).map((d) => ({ type: d.type, label: d.plural })),
      allowedHosts: await ctx.settings.get<unknown>('integrations.allowed_hosts', []),
      connectors: rows.map((r) => ({ ...presentConnector(r), links: byId.get(r.id)?.links ?? 0, failing: byId.get(r.id)?.failing ?? 0 })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/tracker-connectors', summary: 'Connections to an outside work-tracking tool', tag: 'Work trackers', permission: 'admin.administer',
    response: '{ outboundEnabled, allowedHosts, kinds: [{ type, label }] (the kinds of record that can be sent now), connectors: [{ id, name, url_host, active, record_types, push_on_create, include_restricted, status_map, links, failing }] }',
  });

  app.post('/api/admin/tracker-connectors', admin, async (req, reply) => {
    const input = await checkConnector(req, (req.body ?? {}) as Row, null);
    await sensitive(ctx, req, 'adding a work-tracker connection');
    const secret = newSecret();
    const inbound = newSecret();
    const row = await db.tx(async (tx) => {
      const r = (await tx.one<Row>(
        `insert into ticket_connectors (name, url_sealed, url_host, secret_sealed, inbound_secret_sealed, active, record_types, push_on_create,
           include_restricted, status_map, created_by, updated_by)
         values ($1, '', $2, '', '', $3, $4::jsonb, $5, $6, $7::jsonb, $8, $8) returning *`,
        [input.name, new URL(input.url).host, input.active ?? false, JSON.stringify(input.record_types), input.push_on_create ?? false,
          input.include_restricted ?? false, JSON.stringify(input.status_map ?? {}), req.user!.id]))!;
      return (await tx.one<Row>(
        'update ticket_connectors set url_sealed = $2, secret_sealed = $3, inbound_secret_sealed = $4 where id = $1 returning *',
        [r.id, box().encrypt(input.url, URL_CONTEXT(r.id)), box().encrypt(secret, SECRET_CONTEXT(r.id)), box().encrypt(inbound, INBOUND_CONTEXT(r.id))]))!;
    });
    await ctx.audit(req, {
      action: 'tracker_connector.create', recordType: 'tracker_connector', recordId: row.id, summary: `Work-tracker connection added: ${row.name}`,
      after: { name: row.name, host: row.url_host, active: row.active, record_types: input.record_types, include_restricted: row.include_restricted },
    });
    reply.code(201);
    return { ...presentConnector(row), secret, inboundSecret: inbound, inboundAddress: `${await appBase(ctx, req)}/api/integrations/tracker/${row.id}/status` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/tracker-connectors', summary: 'Add a work-tracker connection; its two secrets are shown once', tag: 'Work trackers', permission: 'admin.administer',
    body: '{ name, url, record_types: [one or more kinds from kinds of the list], active?, push_on_create?, include_restricted?, status_map? }',
    response: 'The connection with `secret` (signs what is sent), `inboundSecret` (signs status updates sent back) and `inboundAddress`',
    description: 'Needs a recent password confirmation. include_restricted needs security.view.',
  });

  app.patch('/api/admin/tracker-connectors/:id', admin, async (req) => {
    const before = await connectorOf((req.params as { id: string }).id);
    const input = await checkConnector(req, (req.body ?? {}) as Row, before);
    // Widening what leaves the application asks for the password again.
    if (input.url !== undefined || input.include_restricted === true || (input.active === true && !before.active)) {
      await sensitive(ctx, req, 'changing a work-tracker connection');
    }
    const row = (await db.one<Row>(
      `update ticket_connectors set name = coalesce($2, name), url_sealed = coalesce($3, url_sealed), url_host = coalesce($4, url_host),
         active = coalesce($5, active), record_types = coalesce($6::jsonb, record_types), push_on_create = coalesce($7, push_on_create),
         include_restricted = coalesce($8, include_restricted), status_map = coalesce($9::jsonb, status_map), updated_at = now(), updated_by = $10
       where id = $1 returning *`,
      [before.id, input.name ?? null, input.url ? box().encrypt(input.url, URL_CONTEXT(before.id)) : null, input.url ? new URL(input.url).host : null,
        input.active ?? null, input.record_types ? JSON.stringify(input.record_types) : null, input.push_on_create ?? null,
        input.include_restricted ?? null, input.status_map ? JSON.stringify(input.status_map) : null, req.user!.id]))!;
    const { url: _url, ...shown } = input;
    await ctx.audit(req, {
      action: 'tracker_connector.update', recordType: 'tracker_connector', recordId: row.id, summary: `Work-tracker connection changed: ${row.name}`,
      before: presentConnector(before), after: { ...shown, ...(input.url ? { host: row.url_host } : {}) },
    });
    return presentConnector(row);
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/admin/tracker-connectors/:id', summary: 'Change a work-tracker connection', tag: 'Work trackers', permission: 'admin.administer',
    body: '{ name?, url?, record_types?, active?, push_on_create?, include_restricted?, status_map? }',
    description: 'A new address, sending restricted records, or switching it on needs a recent password confirmation.',
  });

  app.post('/api/admin/tracker-connectors/:id/secrets', admin, async (req) => {
    const c = await connectorOf((req.params as { id: string }).id);
    await sensitive(ctx, req, 'replacing the secrets of a work-tracker connection');
    const secret = newSecret();
    const inbound = newSecret();
    await db.query('update ticket_connectors set secret_sealed = $2, inbound_secret_sealed = $3, updated_at = now(), updated_by = $4 where id = $1',
      [c.id, box().encrypt(secret, SECRET_CONTEXT(c.id)), box().encrypt(inbound, INBOUND_CONTEXT(c.id)), req.user!.id]);
    await ctx.audit(req, { action: 'tracker_connector.secrets', recordType: 'tracker_connector', recordId: c.id, summary: `Work-tracker connection secrets replaced: ${c.name}` });
    return { secret, inboundSecret: inbound, inboundAddress: `${await appBase(ctx, req)}/api/integrations/tracker/${c.id}/status` };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/admin/tracker-connectors/:id/secrets', summary: 'Replace both secrets of a work-tracker connection; shown once', tag: 'Work trackers', permission: 'admin.administer',
    response: '{ secret, inboundSecret, inboundAddress }', description: 'Needs a recent password confirmation. The old secrets stop working at once.',
  });

  app.delete('/api/admin/tracker-connectors/:id', admin, async (req) => {
    const c = await connectorOf((req.params as { id: string }).id);
    await db.query('update ticket_connectors set deleted_at = now(), active = false, updated_at = now(), updated_by = $2 where id = $1', [c.id, req.user!.id]);
    await ctx.audit(req, { action: 'tracker_connector.delete', recordType: 'tracker_connector', recordId: c.id, summary: `Work-tracker connection removed: ${c.name}` });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/admin/tracker-connectors/:id', summary: 'Remove a work-tracker connection (its links stay as history)', tag: 'Work trackers', permission: 'admin.administer' });

  // ---------- on a record ----------

  /** The record if the caller may see it, its type being one the bridge carries. */
  async function visibleRecord(req: FastifyRequest, type: unknown, id: unknown): Promise<{ def: ResourceDef; row: Row }> {
    const def = await kindOn(type);
    const row = def && typeof id === 'string' && UUID_RE.test(id) && ctx.can(req.user, `${def.module}.view`)
      ? await ctx.resources.find(def.type, id, req.user) : undefined;
    if (!def || !row) ctx.fail(404, 'not_found', 'Record not found.');
    return { def: def!, row: row! };
  }

  const connectorsFor = async (type: string) =>
    (await db.query<Row>('select * from ticket_connectors where deleted_at is null and active order by name'))
      .filter((c) => json<string[]>(c.record_types, []).includes(type));

  app.get('/api/tracker/available', async (req) => {
    const type = String((req.query as Row).record_type ?? '');
    const def = await kindOn(type);
    if (!def || !ctx.can(req.user, `${def.module}.view`)) return { available: false };
    const rows = await db.query<Row>('select record_types from ticket_connectors where deleted_at is null');
    return { available: rows.some((r) => json<string[]>(r.record_types, []).includes(type)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/tracker/available', summary: 'Whether any work-tracker connection takes this kind of record (the record page then shows a Work tracker tab)', tag: 'Work trackers',
    query: { record_type: 'The kind of record, one of the kinds a connection can send.' }, response: '{ available }',
  });

  app.get('/api/tracker/links', async (req) => {
    const q = req.query as Row;
    const { def, row } = await visibleRecord(req, q.record_type, q.record_id);
    const links = await db.query<Row>(
      `select l.*, c.name as connector_name from external_ticket_links l join ticket_connectors c on c.id = l.connector_id
        where l.record_type = $1 and l.record_id = $2 order by l.created_at`, [def.type, row.id]);
    const restricted = isRestricted(def, row);
    const connectors = (await connectorsFor(def.type))
      .filter((c) => !restricted || c.include_restricted)
      .filter((c) => !links.some((l) => l.connector_id === c.id))
      .map((c) => ({ id: c.id, name: c.name }));
    return {
      canSend: ctx.can(req.user, `${def.module}.edit`),
      connectors,
      links: links.map((l) => ({
        id: l.id, connector_id: l.connector_id, connector_name: l.connector_name, external_id: l.external_id ?? null,
        external_url: l.external_url ?? null, external_status: l.external_status ?? null, pushed_at: l.pushed_at ?? null,
        push_requested_at: l.push_requested_at ?? null, push_error: l.push_error ?? null, synced_at: l.synced_at ?? null,
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/tracker/links', summary: 'The outside work items of a record, and the connections it can be sent to', tag: 'Work trackers',
    query: { record_type: 'The kind of record, one of the kinds a connection can send.', record_id: 'The record.' },
    response: '{ canSend, connectors: [{ id, name }], links: [{ id, connector_name, external_id, external_url, external_status, pushed_at, push_error, synced_at }] }',
    description: 'Needs view on the record (404 otherwise). A restricted record lists only connections that include restricted records.',
  });

  /** Queues a record for sending. Returns the link row, or null when there is nothing to do. */
  async function request(connector: Row, def: ResourceDef, row: Row, userId: string | null): Promise<Row | null> {
    if (isRestricted(def, row) && !connector.include_restricted) return null;
    const link = await db.one<Row>(
      `insert into external_ticket_links (connector_id, record_type, record_id, push_requested_at, created_by) values ($1, $2, $3, now(), $4)
       on conflict (connector_id, record_type, record_id) do nothing returning *`, [connector.id, def.type, row.id, userId]);
    // A send already running may have read its list before this link: it runs once more (W17 review).
    if (link && app.jobs) await app.jobs.enqueue('feeds.tracker_push', {}, { key: 'feeds.tracker_push', rerunIfRunning: true });
    return link ?? null;
  }

  app.post('/api/tracker/send', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const { def, row } = await visibleRecord(req, b.record_type, b.record_id);
    if (!ctx.can(req.user, `${def.module}.edit`)) ctx.fail(403, 'forbidden', 'You do not have permission to change this record.');
    const connector = (await connectorsFor(def.type)).find((c) => c.id === b.connector_id);
    if (!connector) ctx.fail(404, 'not_found', 'Connection not found, or it does not take this kind of record.');
    if (isRestricted(def, row) && !connector!.include_restricted) ctx.fail(409, 'restricted', 'This record is restricted, and this connection does not take restricted records.');
    const link = await request(connector!, def, row, req.user!.id);
    if (!link) ctx.fail(409, 'already_sent', 'This record has already been sent through this connection.');
    await ctx.audit(req, {
      action: 'tracker.send', recordType: def.type, recordId: row.id, summary: `Queued for the work tracker: ${connector!.name}`,
      after: { connector_id: connector!.id, link_id: link!.id },
    });
    reply.code(202);
    return { id: link!.id, connector_name: connector!.name, push_requested_at: link!.push_requested_at };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/tracker/send', summary: 'Send a record to an outside work-tracking tool', tag: 'Work trackers',
    body: '{ record_type, record_id, connector_id }', response: '202 { id, connector_name, push_requested_at }',
    description: 'Needs edit on the record. Sent by the job feeds.tracker_push, signed like a webhook. 409 restricted when the connection does not take restricted records; 409 already_sent.',
  });

  // Automatic sending on create, for connections that ask for it.
  ctx.resources.onChange?.(async ({ action, def, row, req }) => {
    if (action !== 'create' || !(TRACKER_TYPES as readonly string[]).includes(def.type) || !(await kindOn(def.type))) return;
    for (const c of await connectorsFor(def.type)) {
      if (c.push_on_create) await request(c, def, row, req?.user?.id ?? null);
    }
  });

  // ---------- sending ----------

  async function pushOne(id: string): Promise<'sent' | 'failed' | 'skipped'> {
    // Claim it first, in one statement: a run that overlaps finds it claimed and leaves it.
    const link = await db.one<Row>(
      `update external_ticket_links set push_claimed_at = now(), push_attempts = push_attempts + 1
        where id = $1 and pushed_at is null and push_attempts < $2
          and (push_claimed_at is null or push_claimed_at < now() - interval '5 minutes') returning *`, [id, MAX_ATTEMPTS]);
    if (!link) return 'skipped';
    const fail = async (error: string) => {
      await db.query('update external_ticket_links set push_error = $2 where id = $1', [link.id, error.slice(0, 500)]);
      return 'failed' as const;
    };
    const connector = await db.one<Row>('select * from ticket_connectors where id = $1 and deleted_at is null', [link.connector_id]);
    if (!connector?.active) return fail('The connection is switched off.');
    const def = await kindOn(link.record_type);
    const row = def ? await ctx.resources.find(def.type, link.record_id) : undefined;
    if (!def || !row) return fail('The record is no longer there, or its part of the application is switched off.');
    if (isRestricted(def, row) && !connector.include_restricted) return fail('The record became restricted, and this connection does not take restricted records.');
    if ((await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) !== true) return fail('Outbound connections are switched off (integrations.outbound_enabled).');
    const allowList = await ctx.settings.get<unknown>('integrations.allowed_hosts', []);
    let url: URL;
    try { url = new URL(box().decrypt(connector.url_sealed, URL_CONTEXT(connector.id))); } catch { return fail('The connection\'s address cannot be read.'); }
    if (!hostAllowed(url, allowList)) return fail(`Host ${url.host} is not on the allow-list (integrations.allowed_hosts).`);
    const base = String(await ctx.settings.get<unknown>('auth.public_url', '') ?? '').replace(/\/+$/, '');
    const body = JSON.stringify({
      event: 'tracker.create', link_id: link.id, connector_id: connector.id, sent_at: new Date().toISOString(),
      record: {
        type: def.type, id: row.id, ref: def.ref ? row[def.ref.field] ?? null : null, title: row[def.titleField] ?? null,
        status: row.status ?? null, priority: row.priority ?? row.severity ?? null, due_on: row.due_on ?? row.due_date ?? null,
        url: `${base}${def.route}/${row.id}`, restricted: isRestricted(def, row),
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const secret = box().decrypt(connector.secret_sealed, SECRET_CONTEXT(connector.id));
    try {
      const res = await postWebhook(url, body, {
        'content-type': 'application/json', 'user-agent': 'sandpiper-grc-tracker', 'x-grc-event': 'tracker.create',
        'x-grc-timestamp': String(ts), 'x-grc-signature': signWebhook(secret, ts, body), 'x-grc-delivery': link.id,
      }, allowList);
      if (res.status < 200 || res.status >= 300) return fail(`The work tracker answered ${res.status}.`);
    } catch (err) {
      return fail((err as Error).message || 'The work tracker could not be reached.');
    }
    await db.query('update external_ticket_links set pushed_at = now(), push_error = null where id = $1', [link.id]);
    await ctx.audit(null, {
      action: 'tracker.pushed', recordType: def.type, recordId: row.id, summary: `Sent to the work tracker: ${connector.name}`,
      after: { connector_id: connector.id, link_id: link.id },
    });
    return 'sent';
  }

  async function pushPending(): Promise<{ sent: number; failed: number }> {
    const due = await db.query<{ id: string }>(
      `select id from external_ticket_links where pushed_at is null and push_requested_at is not null and push_attempts < $1
         and (push_claimed_at is null or push_claimed_at < now() - interval '5 minutes') order by push_requested_at limit 200`, [MAX_ATTEMPTS]);
    const out = { sent: 0, failed: 0 };
    for (const { id } of due) {
      const r = await pushOne(id);
      if (r === 'sent') out.sent += 1;
      else if (r === 'failed') out.failed += 1;
    }
    return out;
  }

  // ---------- status coming back (public, signed) ----------

  await app.register(async (scoped) => {
    // The signature covers the exact bytes sent, so the raw body is kept beside the parsed one.
    scoped.removeContentTypeParser('application/json');
    scoped.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 64 * 1024 }, (req, body, done) => {
      (req as unknown as { rawBody: string }).rawBody = String(body);
      try { done(null, JSON.parse(String(body) || '{}')); } catch { done(null, {}); }
    });

    scoped.post('/api/integrations/tracker/:connectorId/status', { config: { public: true, noCsrf: true } }, async (req) => {
      const refuse = () => ctx.fail(401, 'not_verified', 'The request could not be verified.');
      const claim = await inboundLimiter.take(clientIp(req));
      if (!claim.ok) ctx.fail(429, 'rate_limited', 'Too many requests. Try again in a minute.');
      const id = (req.params as { connectorId: string }).connectorId;
      const connector = UUID_RE.test(id)
        ? await db.one<Row>('select * from ticket_connectors where id = $1 and deleted_at is null and active', [id]) : undefined;
      const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
      const ts = String(req.headers['x-grc-timestamp'] ?? '');
      const given = String(req.headers['x-grc-signature'] ?? '');
      if (!connector || !/^\d{9,11}$/.test(ts) || Math.abs(Date.now() - Number(ts) * 1000) > WINDOW_MS) return refuse();
      let expected: string;
      try { expected = signWebhook(box().decrypt(connector.inbound_secret_sealed, INBOUND_CONTEXT(connector.id)), ts, raw); } catch { return refuse(); }
      const a = Buffer.from(given);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return refuse();
      // A copy of a request accepted inside the window is refused; the memory is bounded but never
      // evicts within the window (W17-8).
      if ((await rememberSignature(db, connector.id, given)) !== 'fresh') return refuse();
      await db.query('update ticket_connectors set last_inbound_at = now() where id = $1', [connector.id]);
      return applyStatus(connector, (req.body ?? {}) as Row);
    });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/integrations/tracker/:connectorId/status', summary: 'A work tracker reports the status of an item made from a record', tag: 'Work trackers', public: true,
    body: '{ link_id | external_id, external_url?, status } (JSON), with headers X-GRC-Timestamp (Unix seconds) and X-GRC-Signature: sha256=<HMAC-SHA256 of "<timestamp>.<raw body>" with the inbound secret>',
    response: '{ ok, link_id, external_status, applied: our status | null, reason: null | not_mapped | unchanged | lifecycle | needs_approval | sender_cannot_edit | unknown_status | record_gone }',
    description: 'No session. 401 not_verified, always the same, for an unknown or switched-off connection, a timestamp more than 5 minutes off, a bad signature, a copy of a request already accepted, or more than 10,000 accepted updates on one connection within 10 minutes. 429 past 300 requests a minute from one address. The outside status is kept; the record moves only to a status the connection\'s status map names, as the record type\'s lifecycle allows for the person who sent it.',
  });

  async function applyStatus(connector: Row, b: Row) {
    const status = typeof b.status === 'string' ? b.status.trim().slice(0, 100) : '';
    if (!status) ctx.fail(400, 'validation', 'Send the outside status as `status`.', { status: 'Required.' });
    const link = typeof b.link_id === 'string' && UUID_RE.test(b.link_id)
      ? await db.one<Row>('select * from external_ticket_links where id = $1 and connector_id = $2', [b.link_id, connector.id])
      : typeof b.external_id === 'string' && b.external_id
        ? await db.one<Row>('select * from external_ticket_links where connector_id = $1 and external_id = $2', [connector.id, b.external_id.slice(0, 200)])
        : undefined;
    if (!link) ctx.fail(404, 'not_found', 'No item of this connection matches link_id or external_id.');
    const externalUrl = typeof b.external_url === 'string' && /^https?:\/\/\S+$/.test(b.external_url) && b.external_url.length <= 1000 ? b.external_url : null;
    await db.query(
      `update external_ticket_links set external_status = $2, external_id = coalesce($3, external_id), external_url = coalesce($4, external_url), synced_at = now()
        where id = $1`, [link!.id, status, typeof b.external_id === 'string' ? b.external_id.slice(0, 200) : null, externalUrl]);

    // Move the record when the status map names one of ours, as the lifecycle allows for the sender.
    const mapped = json<Row>(connector.status_map, {})[link!.record_type]?.[status] as string | undefined;
    const def = await kindOn(link!.record_type);
    let applied: string | null = null;
    let reason: string | null = mapped ? (def ? null : 'record_gone') : 'not_mapped';
    if (mapped && def) {
      const existing = await ctx.resources.find(def.type, link!.record_id);
      const sender = link!.created_by ? await loadUser(db, link!.created_by) : null;
      const values = def.fields.status?.list ? await ctx.lookups.values(def.fields.status.list) : [];
      if (!existing) reason = 'record_gone';
      else if (!values.some((v) => v.value === mapped)) reason = 'unknown_status';
      else if (existing.status === mapped) reason = 'unchanged';
      else if (!sender || !ctx.can(sender, `${def.module}.edit`)) reason = 'sender_cannot_edit';
      else {
        const asSender = { user: sender, headers: {}, id: 'work-tracker' } as unknown as FastifyRequest;
        const problems = await app.lifecycles.check(def, existing, { status: mapped }, asSender);
        const held = Object.keys(problems).length ? null : await app.lifecycles.held(def, existing, { status: mapped }, asSender);
        if (Object.keys(problems).length) reason = 'lifecycle';
        else if (held) reason = 'needs_approval';
        else {
          try {
            await ctx.resources.update(def.type, existing.id, { status: mapped });
            applied = mapped;
            await ctx.audit(null, {
              action: 'tracker.status', recordType: def.type, recordId: existing.id,
              summary: `Status brought back from the work tracker (${connector.name}): ${status}`,
              before: { status: existing.status }, after: { status: mapped },
            });
          } catch (err) {
            reason = (err as { code?: string }).code ?? 'refused';
          }
        }
      }
    }
    return { ok: true, link_id: link!.id, external_status: status, applied, reason };
  }

  return { pushPending, pushOne };
}

const pushers = new WeakMap<object, { pushPending(): Promise<{ sent: number; failed: number }>; pushOne(id: string): Promise<string> }>();

/** The push functions of an application (tests run two at once to check the claim). */
export const trackerPusher = (app: object) => pushers.get(app);

/** Registers the routes and the push job. */
export async function registerTrackerWithJobs(ctx: ModuleContext) {
  const t = await registerTracker(ctx);
  pushers.set(ctx.app, t);
  await scheduleWork(ctx, 'feeds.tracker_push', () => t.pushPending(), { every: 60_000, firstRunInMs: 90_000 });
  return t;
}
