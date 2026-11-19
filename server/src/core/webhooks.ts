import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { ResourceDef, Row, SessionUser } from './module.ts';
import type { makeResources, RecordChange } from './resource.ts';
import type { SecretBox } from './secretbox.ts';
import { can, requirePerm, type makeAudit, type makeSettings } from './services.ts';

/**
 * Outbound webhooks (E13-06).
 *
 * The one place the application opens a connection to somewhere else, so it is fenced three ways:
 *  1. Nothing is queued or sent unless the setting `integrations.outbound_enabled` is on (default off).
 *  2. A delivery goes only to a host on the allow-list `integrations.allowed_hosts`; anything else
 *     is recorded as `blocked`. Redirects are never followed.
 *  3. Restricted records are left out unless the subscription says `include_restricted`, which only
 *     a person holding `security.view` can switch on, and which stops applying if the person who
 *     created the subscription no longer holds it.
 *
 * Deliveries are rows in `webhook_deliveries`, worked through by an in-process timer, so a restart
 * loses nothing. Each is signed: `X-GRC-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`
 * with the timestamp in `X-GRC-Timestamp` (seconds). Failures are retried with growing gaps (RETRY_MINUTES).
 */

/** Minutes to wait before attempts 2, 3, ... A delivery fails for good after the last one. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];
const EVENT_RE = /^(\*|[a-z][a-z0-9_]*\.(\*|create|update|delete|test))$/;
const TIMEOUT_MS = 10_000;

export const signWebhook = (secret: string, timestamp: string | number, body: string) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/** Whether a host (with optional port) is on the allow-list. Entries: `host`, `host:port` or `*.domain`. */
export function hostAllowed(url: URL, allowList: unknown): boolean {
  if (!Array.isArray(allowList)) return false;
  const host = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return allowList.some((raw) => {
    const entry = String(raw).trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith('*.')) return host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
    const m = /^(.*):(\d+)$/.exec(entry);
    return m ? m[1] === host && m[2] === port : entry === host;
  });
}

const matches = (events: string[], type: string, action: string) =>
  events.some((e) => e === '*' || e === `${type}.*` || e === `${type}.${action}`);

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  settings: ReturnType<typeof makeSettings>;
  res: ReturnType<typeof makeResources>;
  box: () => SecretBox;
  loadUser(db: Db, userId: string): Promise<SessionUser | null>;
  requireRecentAuth(req: FastifyRequest, what: string): Promise<void>;
}

export function registerWebhooks({ app, db, audit, settings, res, box, loadUser, requireRecentAuth }: Deps) {
  const admin = { preHandler: requirePerm('admin.administer') };
  const invalid = (fields: Record<string, string>): never => fail(400, 'validation', 'Check the highlighted fields.', fields);
  const enabled = async () => (await settings.get<unknown>('integrations.outbound_enabled', false)) === true;
  const allowList = () => settings.get<unknown>('integrations.allowed_hosts', []);
  const seal = (id: string, secret: string) => box().encrypt(secret, `webhook:${id}`);
  const open = (id: string, sealed: string) => box().decrypt(sealed, `webhook:${id}`);

  // ---------- queueing ----------

  async function enqueue(hook: Row, event: string, payload: Row, recordType?: string, recordId?: string): Promise<string> {
    const row = await db.one<{ id: string }>(
      `insert into webhook_deliveries (webhook_id, event, record_type, record_id, payload) values ($1,$2,$3,$4,$5::jsonb) returning id`,
      [hook.id, event, recordType ?? null, recordId ?? null, JSON.stringify(payload)]);
    return row!.id;
  }

  const isRestricted = (def: ResourceDef, row: Row) => def.restricted === true || (def.restricted === 'flag' && row.restricted === true);

  res.onChange(async (change: RecordChange) => {
    if (change.action === 'purge' || !(await enabled())) return;
    const { def, row, action } = change;
    const hooks = await db.query<Row>('select * from webhooks where active and deleted_at is null');
    let queued = 0;
    for (const hook of hooks) {
      if (!matches(hook.events as string[], def.type, action)) continue;
      if (isRestricted(def, row)) {
        // Only by explicit choice, and only while the person who made that choice still holds security.view.
        if (!hook.include_restricted) continue;
        const creator = hook.created_by ? await loadUser(db, hook.created_by) : null;
        if (!creator || !can(creator, 'security.view')) continue;
      }
      await enqueue(hook, `${def.type}.${action}`, {
        event: `${def.type}.${action}`,
        occurredAt: new Date().toISOString(),
        record: { type: def.type, id: row.id, ref: def.ref ? row[def.ref.field] ?? null : null, label: res.labelOf(def, row), route: `${def.route}/${row.id}` },
        data: { ...res.pickFields(def, row), ...res.customOf(row) },
        ...(action === 'update' ? { changes: { before: change.before, after: change.after } } : {}),
        actor: change.req?.user ? { id: change.req.user.id, name: change.req.user.displayName } : null,
      }, def.type, row.id);
      queued += 1;
    }
    if (queued && autoRun) setImmediate(() => { void processDue().catch((err) => console.error('[webhooks]', err)); });
  });

  // ---------- sending ----------

  async function attempt(d: Row): Promise<void> {
    const finish = (status: string, fields: { code?: number | null; error?: string | null; next?: number | null }) => db.query(
      `update webhook_deliveries set status = $2, attempts = attempts + 1, last_attempt_at = now(), response_status = $3, last_error = $4,
         delivered_at = case when $2 = 'delivered' then now() else null end,
         next_attempt_at = case when $5::int is null then next_attempt_at else now() + make_interval(mins => $5::int) end
       where id = $1`,
      [d.id, status, fields.code ?? null, fields.error ? fields.error.slice(0, 500) : null, fields.next ?? null]);

    if (!(await enabled())) { await finish('blocked', { error: 'Outbound connections are switched off (integrations.outbound_enabled).' }); return; }
    if (!d.active || d.deleted_at) { await finish('blocked', { error: 'The webhook is switched off or was removed.' }); return; }
    let url: URL;
    try { url = new URL(d.url); } catch { await finish('blocked', { error: 'The webhook address is not a valid URL.' }); return; }
    if (!hostAllowed(url, await allowList())) { await finish('blocked', { error: `Host ${url.host} is not on the allow-list (integrations.allowed_hosts).` }); return; }

    const body = JSON.stringify({ id: d.id, ...(d.payload as Row) });
    const timestamp = String(Math.floor(Date.now() / 1000));
    let code: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(url, {
        method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json', 'user-agent': 'grc-webhook/1',
          'x-grc-event': d.event, 'x-grc-delivery': d.id, 'x-grc-timestamp': timestamp,
          'x-grc-signature': signWebhook(open(d.webhook_id, d.secret), timestamp, body),
        },
      });
      code = response.status;
      await response.arrayBuffer().catch(() => undefined); // drain; the answer's body is not kept
      if (code < 200 || code >= 300) error = `The receiver answered ${code}.`;
    } catch (err) {
      error = (err as Error).name === 'TimeoutError' ? `No answer within ${TIMEOUT_MS / 1000} seconds.` : `Could not connect: ${(err as Error).message}`;
    }
    if (!error) { await finish('delivered', { code }); return; }
    const wait = RETRY_MINUTES[d.attempts]; // attempts so far, before this one
    if (wait === undefined) await finish('failed', { code, error });
    else await finish('pending', { code, error, next: wait });
  }

  let running = false;
  /** Sends every delivery that is due. Returns how many were attempted. */
  async function processDue(limit = 25): Promise<number> {
    if (running) return 0;
    running = true;
    try {
      const due = await db.query<Row>(
        `select d.*, w.url, w.secret, w.active, w.deleted_at from webhook_deliveries d join webhooks w on w.id = d.webhook_id
         where d.status = 'pending' and d.next_attempt_at <= now() order by d.created_at limit $1`, [limit]);
      for (const d of due) await attempt(d);
      return due.length;
    } finally {
      running = false;
    }
  }

  // The in-process queue: a timer, not started under test (tests call processDue themselves).
  const autoRun = !process.env.VITEST;
  let timer: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    if (!autoRun) return;
    timer = setInterval(() => { void processDue().catch((err) => console.error('[webhooks]', err)); }, 30_000);
    timer.unref();
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); });

  // ---------- administration ----------

  const publicHook = ({ secret, ...h }: Row) => h;
  const LIST = `
    select w.*, (select count(*)::int from webhook_deliveries d where d.webhook_id = w.id and d.status = 'pending') as pending,
      (select count(*)::int from webhook_deliveries d where d.webhook_id = w.id and d.status in ('failed', 'blocked') and d.created_at > now() - interval '7 days') as failed_recently,
      (select max(d.delivered_at) from webhook_deliveries d where d.webhook_id = w.id) as last_delivered_at
    from webhooks w where w.deleted_at is null`;
  const one = async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`${LIST} and w.id = $1`, [id]) : undefined;
    return row ?? fail(404, 'not_found', 'Webhook not found.');
  };

  function clean(b: Row, existing?: Row) {
    const fields: Record<string, string> = {};
    const out: Row = {};
    if (b.name !== undefined || !existing) {
      out.name = String(b.name ?? '').trim();
      if (!out.name || out.name.length > 80) fields.name = 'Enter a name of up to 80 characters.';
    }
    if (b.url !== undefined || !existing) {
      out.url = String(b.url ?? '').trim();
      let u: URL | null = null;
      try { u = new URL(out.url); } catch { /* reported below */ }
      if (!u || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || out.url.length > 500) {
        fields.url = 'Enter an http or https address with no user name or password in it.';
      }
    }
    if (b.events !== undefined || !existing) {
      out.events = Array.isArray(b.events) ? [...new Set(b.events.map((e: unknown) => String(e).trim()))] : [];
      if (!out.events.length) fields.events = 'Choose at least one event.';
      else if (out.events.some((e: string) => !EVENT_RE.test(e))) fields.events = 'Events look like "ticket.create", "ticket.*" or "*" (actions: create, update, delete).';
      else {
        const unknown = out.events.map((e: string) => e.split('.')[0]).filter((t: string) => t !== '*' && !res.registry.get(t));
        if (unknown.length) fields.events = `Unknown record type: ${unknown.join(', ')}.`;
      }
    }
    if (b.active !== undefined) out.active = b.active === true;
    if (b.includeRestricted !== undefined) out.include_restricted = b.includeRestricted === true;
    return { out, fields };
  }

  app.get('/api/admin/webhooks', admin, async () => ({
    webhooks: (await db.query<Row>(`${LIST} order by lower(w.name)`)).map(publicHook),
    outboundEnabled: await enabled(),
    allowedHosts: await allowList(),
    retryMinutes: RETRY_MINUTES,
    recordTypes: res.registry.all().map((d) => ({ type: d.type, label: d.label, restricted: d.restricted ?? false })).sort((a, b) => a.label.localeCompare(b.label)),
    actions: ['create', 'update', 'delete'],
  }));

  app.post('/api/admin/webhooks', admin, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const { out, fields } = clean(b);
    // Sending restricted records is a choice only someone who can see them may make.
    if (out.include_restricted && !can(req.user, 'security.view')) fields.includeRestricted = 'Only a person who holds security.view can include restricted records.';
    const secret = b.secret === undefined || b.secret === '' ? randomBytes(32).toString('base64url') : String(b.secret);
    if (secret.length < 16 || secret.length > 200) fields.secret = 'Use a secret of 16 to 200 characters, or leave it empty to have one generated.';
    if (Object.keys(fields).length) invalid(fields);
    await requireRecentAuth(req, 'adding a webhook');
    const row = (await db.one<Row>(
      `insert into webhooks (name, url, secret, events, active, include_restricted, created_by, updated_by)
       values ($1,$2,'',$3::jsonb,$4,$5,$6,$6) returning id`,
      [out.name, out.url, JSON.stringify(out.events), out.active ?? true, out.include_restricted ?? false, req.user!.id]))!;
    await db.query('update webhooks set secret = $2 where id = $1', [row.id, seal(row.id, secret)]);
    await audit(req, {
      action: 'webhook.create', recordType: 'webhook', recordId: row.id,
      summary: `Webhook "${out.name}" added for ${new URL(out.url).host}${out.include_restricted ? ' (includes restricted records)' : ''}`,
      after: { name: out.name, url: out.url, events: out.events, active: out.active ?? true, include_restricted: out.include_restricted ?? false },
    });
    reply.code(201);
    // The secret is shown now and never again.
    return { ...publicHook((await db.one<Row>(`${LIST} and w.id = $1`, [row.id]))!), secret };
  });

  app.patch('/api/admin/webhooks/:id', admin, async (req) => {
    const before = await one(req);
    const { out, fields } = clean((req.body ?? {}) as Row, before);
    if (out.include_restricted && !before.include_restricted && !can(req.user, 'security.view')) {
      fields.includeRestricted = 'Only a person who holds security.view can include restricted records.';
    }
    // Pointing a webhook that sends restricted records somewhere else is the same choice again.
    if (out.url !== undefined && out.url !== before.url && (out.include_restricted ?? before.include_restricted) && !can(req.user, 'security.view')) {
      fields.url = 'This webhook includes restricted records: only a person who holds security.view can change its address.';
    }
    if (Object.keys(fields).length) invalid(fields);
    if ((out.url !== undefined && out.url !== before.url) || (out.include_restricted && !before.include_restricted)) {
      await requireRecentAuth(req, 'changing where a webhook sends, or what it may include');
    }
    const next = { ...before, ...out };
    await db.query(
      `update webhooks set name = $2, url = $3, events = $4::jsonb, active = $5, include_restricted = $6, updated_at = now(), updated_by = $7,
         created_by = case when $8 then $7 else created_by end where id = $1`,
      // The person who opts in to restricted records becomes the one whose security.view is checked.
      [before.id, next.name, next.url, JSON.stringify(next.events), next.active, next.include_restricted, req.user!.id,
        Boolean(out.include_restricted && !before.include_restricted)]);
    const pick = (h: Row) => ({ name: h.name, url: h.url, events: h.events, active: h.active, include_restricted: h.include_restricted });
    await audit(req, { action: 'webhook.update', recordType: 'webhook', recordId: before.id, summary: `Webhook "${next.name}" changed`, before: pick(before), after: pick(next) });
    return publicHook((await db.one<Row>(`${LIST} and w.id = $1`, [before.id]))!);
  });

  app.delete('/api/admin/webhooks/:id', admin, async (req) => {
    const before = await one(req);
    await db.query('update webhooks set deleted_at = now(), active = false, updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await db.query(`update webhook_deliveries set status = 'blocked', last_error = 'The webhook was removed.' where webhook_id = $1 and status = 'pending'`, [before.id]);
    await audit(req, { action: 'webhook.delete', recordType: 'webhook', recordId: before.id, summary: `Webhook "${before.name}" removed`, before: { name: before.name, url: before.url } });
    return { ok: true };
  });

  app.post('/api/admin/webhooks/:id/rotate-secret', admin, async (req) => {
    const before = await one(req);
    await requireRecentAuth(req, 'replacing a webhook secret');
    const secret = randomBytes(32).toString('base64url');
    await db.query('update webhooks set secret = $2, updated_at = now(), updated_by = $3 where id = $1', [before.id, seal(before.id, secret), req.user!.id]);
    await audit(req, { action: 'webhook.rotate_secret', recordType: 'webhook', recordId: before.id, summary: `Secret of webhook "${before.name}" replaced` });
    return { ok: true, secret };
  });

  // Queues a test event. It is sent like any other, so the same switches and allow-list apply.
  app.post('/api/admin/webhooks/:id/test', admin, async (req) => {
    const hook = await one(req);
    const id = await enqueue(hook, 'webhook.test', { event: 'webhook.test', occurredAt: new Date().toISOString(), message: `Test delivery for "${hook.name}".` });
    await audit(req, { action: 'webhook.test', recordType: 'webhook', recordId: hook.id, summary: `Test delivery queued for webhook "${hook.name}"` });
    await processDue();
    return db.one('select id, event, status, attempts, response_status, last_error, created_at, delivered_at, next_attempt_at from webhook_deliveries where id = $1', [id]);
  });

  app.get('/api/admin/webhooks/:id/deliveries', admin, async (req) => {
    const hook = await one(req);
    const q = req.query as Record<string, string>;
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
    const status = ['pending', 'delivered', 'failed', 'blocked'].includes(q.status) ? q.status : null;
    const total = (await db.one<{ c: number }>(
      'select count(*)::int c from webhook_deliveries where webhook_id = $1 and ($2::text is null or status = $2)', [hook.id, status]))!.c;
    const rows = await db.query(
      `select id, event, record_type, record_id, status, attempts, response_status, last_error, created_at, last_attempt_at, delivered_at,
              case when status = 'pending' then next_attempt_at end as next_attempt_at
       from webhook_deliveries where webhook_id = $1 and ($2::text is null or status = $2)
       order by created_at desc, id limit ${pageSize} offset ${(page - 1) * pageSize}`, [hook.id, status]);
    return { rows, total, page, pageSize };
  });

  // Puts a failed or blocked delivery back in the queue, with its attempts counted from nothing.
  app.post('/api/admin/webhook-deliveries/:id/retry', admin, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(
      `update webhook_deliveries set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
       where id = $1 and status in ('failed', 'blocked') returning id, webhook_id, event`, [id]) : undefined;
    if (!row) fail(404, 'not_found', 'No failed or blocked delivery with that id.');
    await audit(req, { action: 'webhook.retry', recordType: 'webhook', recordId: row!.webhook_id, summary: `Delivery of ${row!.event} queued again` });
    await processDue();
    return db.one('select id, event, status, attempts, response_status, last_error, delivered_at, next_attempt_at from webhook_deliveries where id = $1', [id]);
  });

  return { processDue, enqueue };
}
