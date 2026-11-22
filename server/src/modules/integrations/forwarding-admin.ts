// Administration > Log forwarding (E36-02): the forwarders, a test event, and each one's delivery log.
// Every route needs admin.administer; where a forwarder sends (kind, host, port, address, secret,
// certificate authority) and switching one on also need a recent password confirmation.
import type { FastifyRequest } from 'fastify';
import { secretBox } from '../../core/auth.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { urlFingerprint } from '../../core/webhooks.ts';
import { sensitive } from '../admin/shared.ts';
import { checkCa, FORWARDER_KINDS, forwarderSecretContext, forwarderUrlContext, makeForwarding } from './forwarding.ts';

const A = 'admin.administer';
const TAG = 'Log forwarding';
const HOST_RE = /^(?:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const ACTION_RE = /^[a-z0-9_.]{1,63}\*?$/;

export function registerForwardingAdmin(ctx: ModuleContext, forwarding: ReturnType<typeof makeForwarding>) {
  const { app, db } = ctx;
  const admin = { preHandler: ctx.requirePerm(A) };
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const d = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, summary: string, extra: Row = {}) =>
    ctx.describeRoute({ method, path, summary, permission: A, tag: TAG, ...extra } as never);
  const box = () => secretBox(db);

  const SELECT = `select f.id, f.name, f.kind, f.host, f.port, f.format, f.include_actions, f.active, f.cursor_id::text as cursor_id,
      f.failures, f.retry_at, f.last_success_at, f.last_error, f.created_at, f.updated_at,
      (f.url_sealed is not null) as has_url, (f.secret_sealed is not null) as has_secret, (f.ca_cert is not null) as has_ca,
      greatest(0, coalesce((select max(id) from audit_events), 0) - f.cursor_id)::int as waiting
    from audit_forwarders f where f.deleted_at is null`;
  const one = async (req: FastifyRequest) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`select * from audit_forwarders where id = $1 and deleted_at is null`, [id]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Forwarder not found.');
  };
  const publicOne = async (id: string) => db.one<Row>(`${SELECT} and f.id = $1`, [id]);

  /** Checks a body; returns the columns to write and what changed where events go. */
  function clean(b: Row, existing?: Row) {
    const fields: Record<string, string> = {};
    const out: Row = {};
    const kind = (b.kind ?? existing?.kind) as string;
    const kindChanged = Boolean(existing && b.kind !== undefined && b.kind !== existing.kind);
    const has = (k: string) => b[k] !== undefined || !existing || kindChanged;
    if (b.name !== undefined || !existing) {
      out.name = String(b.name ?? '').trim();
      if (!out.name || (out.name as string).length > 80) fields.name = 'Enter a name of up to 80 characters.';
    }
    if (!(FORWARDER_KINDS as readonly string[]).includes(kind)) fields.kind = 'Choose syslog over TLS, syslog over TCP or JSON over HTTPS.';
    if (b.kind !== undefined || !existing) out.kind = kind;
    if (kind === 'https_json') {
      const raw = b.url === undefined || b.url === null ? '' : String(b.url).trim();
      // An empty address in a change keeps the one stored (the screen never holds it).
      const keep = !raw && existing?.kind === 'https_json' && Boolean(existing.url_sealed);
      if (!keep) {
        let u: URL | null = null;
        try { u = new URL(raw); } catch { /* reported below */ }
        if (!u || u.protocol !== 'https:' || u.username || u.password || raw.length > 500) {
          fields.url = 'Enter the https address of the collector, with no user name or password in it.';
        } else {
          out.url = raw;
          out.host = u.host;
          out.port = null;
        }
      }
      out.format = 'json_lines';
    } else if (kind) {
      if (has('host')) {
        const host = String(b.host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
        if (!host || host.length > 253 || !(HOST_RE.test(host) || /^[0-9.]+$/.test(host) || host.includes(':'))) fields.host = 'Enter the collector\'s host name or address.';
        out.host = host;
      }
      if (has('port')) {
        const port = b.port === undefined || b.port === null || b.port === '' ? (kind === 'syslog_tls' ? 6514 : 514) : Number(b.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) fields.port = 'Enter a port from 1 to 65535.';
        out.port = port;
      }
      if (has('format')) {
        out.format = b.format ?? 'rfc5424';
        if (!['rfc5424', 'json_lines'].includes(out.format as string)) fields.format = 'Choose RFC 5424 syslog or JSON lines.';
      }
      if (existing?.kind === 'https_json' && b.kind !== undefined) out.url = null; // no longer an address
    }
    if (b.secret !== undefined) {
      if (b.secret === null || b.secret === '') out.secret = null;
      else if (typeof b.secret !== 'string' || b.secret.length < 8 || b.secret.length > 500) fields.secret = 'Use 8 to 500 characters, or leave it empty for none.';
      else out.secret = b.secret;
    }
    if (b.caCert !== undefined) {
      const ca = checkCa(b.caCert);
      if (ca && typeof ca === 'object') fields.caCert = ca.error; else out.ca_cert = ca;
    }
    if (b.includeActions !== undefined || !existing) {
      const list = Array.isArray(b.includeActions) ? [...new Set(b.includeActions.map((a: unknown) => String(a).trim()).filter(Boolean))] : [];
      if (list.length > 50 || list.some((a) => !ACTION_RE.test(a as string))) fields.includeActions = 'List up to 50 actions such as "signin.failure", or families such as "user." or "webhook.*".';
      out.include_actions = list;
    }
    if (b.active !== undefined) out.active = b.active === true;
    return { out, fields };
  }

  const destinationChanged = (out: Row, before?: Row) => !before
    || ['kind', 'host', 'port', 'url', 'secret', 'ca_cert'].some((k) => out[k] !== undefined && (k === 'url' || k === 'secret' || out[k] !== before[k]));

  async function store(id: string, out: Row) {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col} = $${params.length}${cast}`); };
    for (const col of ['name', 'kind', 'host', 'port', 'format', 'active', 'ca_cert']) if (out[col] !== undefined) set(col, out[col]);
    if (out.include_actions !== undefined) set('include_actions', JSON.stringify(out.include_actions), '::jsonb');
    if (out.url !== undefined) set('url_sealed', out.url === null ? null : box().encrypt(String(out.url), forwarderUrlContext(id)));
    if (out.secret !== undefined) set('secret_sealed', out.secret === null ? null : box().encrypt(String(out.secret), forwarderSecretContext(id)));
    if (sets.length) await db.query(`update audit_forwarders set ${sets.join(', ')}, updated_at = now() where id = $1`, params);
  }

  /** What the audit log keeps about a forwarder: never the address's path or the secret. */
  const described = (f: Row, url?: string | null) => ({
    name: f.name, kind: f.kind, host: f.host, port: f.port, format: f.format, active: f.active,
    include_actions: f.include_actions, ...(url ? { url_fingerprint: urlFingerprint(url) } : {}),
  });

  app.get('/api/admin/audit-forwarders', admin, async () => ({
    forwarders: await db.query(`${SELECT} order by lower(f.name)`),
    outboundEnabled: (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true,
    allowedHosts: await ctx.settings.get<unknown>('integrations.allowed_hosts', []),
    logDays: Number(await ctx.settings.get('retention.audit_forward_log_days', 30)) || 30,
    kinds: FORWARDER_KINDS,
  }));
  d('GET', '/api/admin/audit-forwarders', 'Audit-log forwarders, with whether outbound connections are on and the allow-list', {
    response: '{ forwarders: [{ id, name, kind, host, port, format, include_actions, active, cursor_id, waiting, failures, retry_at, last_success_at, last_error, has_url, has_secret, has_ca }], outboundEnabled, allowedHosts, logDays, kinds }',
  });

  app.post('/api/admin/audit-forwarders', admin, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const { out, fields } = clean(b);
    if (out.kind === 'https_json' && !out.url && !fields.url) fields.url = 'Enter the https address of the collector.';
    const start = b.startFrom ?? 'now';
    if (!['now', 'beginning'].includes(String(start))) fields.startFrom = 'Choose to send events from now on, or from the beginning of the audit log.';
    if (Object.keys(fields).length) invalid(fields);
    await sensitive(ctx, req, 'adding an audit-log forwarder');
    const cursor = start === 'beginning' ? '0' : String((await db.one<{ m: string | null }>('select max(id)::text as m from audit_events'))?.m ?? '0');
    const row = (await db.one<Row>(
      `insert into audit_forwarders (name, kind, host, active, cursor_id, created_by, updated_by) values ($1, $2, $3, false, $4::bigint, $5, $5) returning id`,
      [out.name, out.kind, out.host ?? '', cursor, req.user!.id]))!;
    await store(row.id, { ...out, active: out.active ?? false });
    const saved = (await db.one<Row>('select * from audit_forwarders where id = $1', [row.id]))!;
    await ctx.audit(req, {
      action: 'audit_forwarder.create', recordType: 'audit_forwarder', recordId: row.id,
      summary: `Audit-log forwarder "${out.name}" added (${out.kind} to ${out.host}${saved.active ? ', switched on' : ', switched off'}; ${start === 'beginning' ? 'from the beginning of the log' : 'from now on'})`,
      after: described(saved, out.url as string | undefined),
    });
    reply.code(201);
    return publicOne(row.id);
  });
  d('POST', '/api/admin/audit-forwarders', 'Add an audit-log forwarder', {
    body: '{ name, kind: "syslog_tls" | "syslog_tcp" | "https_json", host?, port?, url?, secret?, caCert?, format?: "rfc5424" | "json_lines", includeActions?: [], active?, startFrom?: "now" | "beginning" }',
    description: 'Needs a recent password confirmation (403 `reauth_required`). Off unless `active` is true. Syslog takes `host` and `port` (6514 over TLS, 514 over TCP by default); HTTPS takes `url` (https only) and an optional `secret`, sent as a bearer token and used to sign each batch. The address and secret are kept encrypted. `caCert`: a PEM certificate authority trusted besides the usual ones, for a private collector.',
  });

  app.patch('/api/admin/audit-forwarders/:id', admin, async (req) => {
    const before = await one(req);
    const { out, fields } = clean((req.body ?? {}) as Row, before);
    if (Object.keys(fields).length) invalid(fields);
    if (destinationChanged(out, before) || (out.active === true && !before.active)) {
      await sensitive(ctx, req, 'changing where an audit-log forwarder sends, or switching it on');
    }
    await store(before.id, out);
    if (out.active === true && !before.active) await db.query('update audit_forwarders set failures = 0, retry_at = null where id = $1', [before.id]);
    const after = (await db.one<Row>('select * from audit_forwarders where id = $1', [before.id]))!;
    await ctx.audit(req, {
      action: 'audit_forwarder.update', recordType: 'audit_forwarder', recordId: before.id, summary: `Audit-log forwarder "${after.name}" changed`,
      before: described(before), after: described(after, out.url as string | undefined),
    });
    return publicOne(before.id);
  });
  d('PATCH', '/api/admin/audit-forwarders/:id', 'Change an audit-log forwarder', {
    body: 'As POST, every field optional (`secret: null` removes it; an empty `url` keeps the address)',
    description: 'Changing where it sends (kind, host, port, address, secret, certificate authority), or switching it on, needs a recent password confirmation.',
  });

  app.delete('/api/admin/audit-forwarders/:id', admin, async (req) => {
    const before = await one(req);
    await db.query('update audit_forwarders set deleted_at = now(), active = false, url_sealed = null, secret_sealed = null, updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, { action: 'audit_forwarder.delete', recordType: 'audit_forwarder', recordId: before.id, summary: `Audit-log forwarder "${before.name}" removed`, before: described(before) });
    return { ok: true };
  });
  d('DELETE', '/api/admin/audit-forwarders/:id', 'Remove an audit-log forwarder (its address and secret are erased; its log is kept until its retention ends)');

  app.post('/api/admin/audit-forwarders/:id/test', admin, async (req) => {
    const f = await one(req);
    const result = await forwarding.test(f);
    await ctx.audit(req, { action: 'audit_forwarder.test', recordType: 'audit_forwarder', recordId: f.id, summary: `Test event sent to audit-log forwarder "${f.name}": ${result.ok ? 'delivered' : `failed (${result.error})`}` });
    return result;
  });
  d('POST', '/api/admin/audit-forwarders/:id/test', 'Send one test event now', { response: '{ ok, error? }', description: 'Through the same switches, allow-list and certificate checks as real events; it moves no cursor.' });

  app.get('/api/admin/audit-forwarders/:id/log', admin, async (req) => {
    const f = await one(req);
    const q = req.query as Record<string, string>;
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
    const page = Math.min(100000, Math.max(1, Math.trunc(Number(q.page)) || 1));
    const total = (await db.one<{ c: number }>('select count(*)::int c from audit_forward_log where forwarder_id = $1', [f.id]))!.c;
    const rows = await db.query(
      `select id, from_id::text as from_id, to_id::text as to_id, count, status, error, attempted_at from audit_forward_log
       where forwarder_id = $1 order by attempted_at desc, id limit ${pageSize} offset ${(page - 1) * pageSize}`, [f.id]);
    return { rows, total, page, pageSize };
  });
  d('GET', '/api/admin/audit-forwarders/:id/log', 'The delivery log of one forwarder', {
    query: { page: 'Page number.', pageSize: 'Rows a page (max 200).' }, response: '{ rows: [{ id, from_id, to_id, count, status, error, attempted_at }], total, page, pageSize }',
  });
}
