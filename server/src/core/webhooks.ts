import { createHmac, randomBytes } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { inTrial, type Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import { featureState } from './features.ts';
import type { ResourceDef, Row, SessionUser } from './module.ts';
import type { makeResources, RecordChange } from './resource.ts';
import { CUSTOM_PREFIX } from './customfields.ts';
import type { SecretBox } from './secretbox.ts';
import { can, requirePerm, type makeAudit, type makeSettings } from './services.ts';

/**
 * Outbound webhooks (E13-06).
 *
 * The one place the application opens a connection to somewhere else, so it is fenced three ways:
 *  1. Nothing is queued or sent unless the setting `integrations.outbound_enabled` is on (default off).
 *  2. A delivery goes only to a host on the allow-list `integrations.allowed_hosts`; anything else
 *     is recorded as `blocked`. Redirects are never followed. The host name is resolved when the
 *     connection is made, and a private, loopback, link-local or otherwise non-public address is
 *     refused (`blocked`) unless that exact address is itself on the allow-list (E13-08), so an
 *     allowed name that resolves somewhere internal cannot be used to reach the inside network.
 *  3. Restricted records are left out unless the subscription says `include_restricted`, which only
 *     a person holding `security.view` can switch on, and which stops applying if the person who
 *     created the subscription no longer holds it.
 *
 * Besides record changes, modules raise the events of a small catalog (WEBHOOK_EVENTS, E13-19) with
 * `emitWebhookEvent`; the same three fences apply, and an event of a switched-off area is not sent.
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

// ---------- address checks at connection time (E13-08) ----------

/** Addresses that are not on the public internet: never reached unless listed exactly. */
const NON_PUBLIC = (() => {
  const b = new BlockList();
  for (const [net, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as const) b.addSubnet(net, bits, 'ipv4');
  for (const [net, bits] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
    ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ] as const) b.addSubnet(net, bits, 'ipv6');
  return b;
})();

const bare = (host: string) => host.replace(/^\[|\]$/g, '').toLowerCase();

/** The IPv4 address carried in an IPv4-mapped or IPv4-compatible IPv6 address, or null. */
function embeddedIpv4(ip: string): string | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

/** True when an IP address is private, loopback, link-local, reserved or otherwise not public. */
export function nonPublicAddress(address: string): boolean {
  const ip = bare(address);
  const family = isIP(ip);
  if (family === 4) return NON_PUBLIC.check(ip, 'ipv4');
  if (family !== 6) return true; // not an address at all: refuse
  const v4 = embeddedIpv4(ip);
  if (v4 && isIP(v4) === 4) return NON_PUBLIC.check(v4, 'ipv4');
  return NON_PUBLIC.check(ip, 'ipv6');
}

/** Whether this exact address (with this port, when the entry names one) is an allow-list entry. Wildcards never count. */
export function addressListed(address: string, port: string, allowList: unknown): boolean {
  if (!Array.isArray(allowList)) return false;
  const ip = bare(address);
  return allowList.some((raw) => {
    const entry = String(raw).trim().toLowerCase();
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry);
    if (v6) return bare(v6[1]) === ip && (!v6[2] || v6[2] === port);
    if (isIP(entry) === 6) return entry === ip;
    const m = /^([^:]+):(\d+)$/.exec(entry);
    return m ? m[1] === ip && m[2] === port : entry === ip;
  });
}

/** Raised (through the connection's name lookup) when an address may not be reached. */
export class AddressBlockedError extends Error {
  code = 'GRC_ADDRESS_BLOCKED';
  constructor(message: string) { super(message); this.name = 'AddressBlockedError'; }
}

/** Why connecting to `address` for `host` is refused, or null when it may be reached. */
export function addressRefusal(host: string, address: string, port: string, allowList: unknown): string | null {
  if (!nonPublicAddress(address) || addressListed(address, port, allowList)) return null;
  const what = bare(host) === bare(address) ? `Address ${address} is` : `Host ${host} resolves to ${address}, which is`;
  return `${what} a private, loopback or reserved address. Add that exact address to the allow-list to send there.`;
}

/**
 * Posts one webhook body. The host name is resolved here, at connection time, and every address it
 * resolves to is checked (a name with one public and one private address is refused too). The
 * connection then goes to the addresses that were checked: nothing is resolved twice.
 */
export function postWebhook(
  url: URL, body: string, headers: Record<string, string>, allowList: unknown, timeoutMs = TIMEOUT_MS,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const host = bare(url.hostname);
    if (isIP(host)) {
      // A literal address is connected to as it is (the lookup below is not called for it).
      const refusal = addressRefusal(host, host, port, allowList);
      if (refusal) { reject(new AddressBlockedError(refusal)); return; }
    }
    const lookup = ((hostname: string, options: { all?: boolean; family?: number } | undefined, callback: (...args: unknown[]) => void) => {
      dnsLookup(hostname, { all: true, family: options?.family ?? 0 }, (err, addresses: LookupAddress[]) => {
        if (err) { callback(err); return; }
        if (!addresses.length) { callback(new Error(`Host ${hostname} has no address.`)); return; }
        for (const a of addresses) {
          const refusal = addressRefusal(hostname, a.address, port, allowList);
          if (refusal) { callback(new AddressBlockedError(refusal)); return; }
        }
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    }) as unknown as RequestOptions['lookup'];
    const timeout = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, {
      method: 'POST', lookup, timeout: timeoutMs,
      headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
    }, (res: IncomingMessage) => {
      res.resume(); // drain; the answer's body is not kept
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      res.on('error', reject);
    });
    // The whole exchange, not only each pause, is limited to `timeoutMs`.
    const timer = setTimeout(() => req.destroy(timeout()), timeoutMs);
    timer.unref?.();
    req.on('timeout', () => req.destroy(timeout()));
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

const matches = (events: string[], type: string, action: string) =>
  events.some((e) => e === '*' || e === `${type}.*` || e === `${type}.${action}`);

// ---------- events other than record changes (E13-19) ----------

/**
 * One event that is not a record change. Modules raise it with `emitWebhookEvent`; nothing else
 * may be emitted, so this list is the whole catalog (documented in docs/api.md).
 *  - `area`: the feature area it belongs to; while that area is switched off nothing is emitted
 *    and the event is not offered on the webhook screen. `null` = always on.
 *  - `restricted`: `always` (about restricted records, such as security incidents), `record` (as
 *    restricted as the record it names) or `never`. A restricted event goes only to a webhook that
 *    includes restricted records, exactly as for record changes.
 *  - `data`: the fields of the payload's `data` object, for the documentation and the screen.
 */
export interface WebhookEventDef {
  event: string;
  label: string;
  description: string;
  area: string | null;
  restricted: 'always' | 'record' | 'never';
  /** The record type the payload's `record` names, when it names one. */
  recordType?: string;
  data: Record<string, string>;
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  {
    event: 'notification_clock.warning', label: 'Notification clock about to run out', area: 'secincidents', restricted: 'always',
    recordType: 'notification_task',
    description: 'A security incident\'s notification deadline is close (the clock turned amber). Raised once per notification task.',
    data: { incidentId: 'Incident id', incidentRef: 'Incident reference', party: 'Who must be notified', required: 'Whether the notification is required (else recommended)', dueAt: 'Deadline (ISO time)', secondsRemaining: 'Seconds left when raised' },
  },
  {
    event: 'notification_clock.overdue', label: 'Notification clock ran out', area: 'secincidents', restricted: 'always',
    recordType: 'notification_task',
    description: 'A security incident\'s notification deadline passed with the notification still pending (the clock turned red). Raised once per notification task.',
    data: { incidentId: 'Incident id', incidentRef: 'Incident reference', party: 'Who must be notified', required: 'Whether the notification is required (else recommended)', dueAt: 'Deadline (ISO time)' },
  },
  {
    event: 'security_incident.declared', label: 'Security incident declared', area: 'secincidents', restricted: 'always',
    recordType: 'security_incident',
    description: 'A security incident was declared, which starts its notification clocks.',
    data: { severity: 'Severity value', declaredAt: 'When it was declared (ISO time)', clocks: 'Notification clocks started', firstDeadline: 'Earliest deadline (ISO time) or null' },
  },
  {
    event: 'change.approval_decided', label: 'Change approval decided', area: 'changes', restricted: 'record',
    recordType: 'change',
    description: 'An approver approved or rejected a change.',
    data: { decision: '`approved` or `rejected`', approver: 'Name of the approver', approvalsReceived: 'Approvals so far', approvalsRequired: 'Approvals needed', status: 'Status of the change afterwards' },
  },
  {
    event: 'report_schedule.delivered', label: 'Scheduled report delivered', area: 'reports', restricted: 'never',
    recordType: 'report_schedule',
    description: 'A report schedule ran. The payload has counts only, never the figures: those are read in the application.',
    data: { name: 'Schedule name', delivered: 'People it reached', skipped: 'People skipped', failed: 'Deliveries that failed' },
  },
  {
    event: 'workflow.decided', label: 'Approval decided', area: null, restricted: 'record',
    description: 'Someone approved or rejected a step of an approval workflow (Administration > Approval workflows) on any record type. Not sent for a record type whose area is switched off.',
    data: { workflow: 'Workflow name', step: 'Step name', decision: '`approved` or `rejected`', approver: 'Name of the approver', comment: 'Their comment, if any', approvalsReceived: 'Approvals of the step so far', approvalsRequired: 'Approvals the step needs', stepOutcome: '`approved`, `rejected` or `pending` (the step still waits for more)' },
  },
  {
    event: 'workflow.finished', label: 'Approval workflow finished', area: null, restricted: 'record',
    description: 'An approval workflow on a record ended: approved after its last step, rejected, or canceled.',
    data: { workflow: 'Workflow name', outcome: '`approved`, `rejected` or `canceled`', reason: 'The rejection comment or why it was canceled, if any', outcomeError: 'Why the fields the workflow sets at the end could not be set, or null' },
  },
  {
    event: 'retention.anonymized', label: 'Record anonymized at the end of its retention period', area: null, restricted: 'record',
    description: 'An administrator anonymized a record from the retention review. Names the fields replaced, never their earlier values. The record-change event `<type>.update` is sent too, with the replaced fields only.',
    data: { recordType: 'Record type', fields: 'Names (keys) of the fields replaced; custom fields as `cf_<key>`', comments: 'Comments whose text and author were removed', files: 'Files whose names and contents were removed' },
  },
  {
    event: 'retention.deleted', label: 'Record removed for good at the end of its retention period', area: null, restricted: 'record',
    description: 'An administrator removed a record for good from the retention review. Names the record by type, id and reference only. The record-change event `<type>.delete` is sent too, without the record\'s fields.',
    data: { recordType: 'Record type', purged: 'Always true: the record no longer exists' },
  },
  {
    event: 'backup.failed', label: 'Backup failed', area: null, restricted: 'never',
    description: 'A scheduled or manual backup failed.',
    data: { runId: 'Backup run id', trigger: '`scheduled` or `manual`', destination: 'Where it was to be written', message: 'Why it failed' },
  },
];

const EVENT_DEFS = new Map(WEBHOOK_EVENTS.map((e) => [e.event, e]));
const EVENT_FAMILIES = new Set(WEBHOOK_EVENTS.map((e) => e.event.split('.')[0]));

/** Whether a subscription list asks for a catalog event: by name, by `<family>.*`, or `*`. */
const matchesEvent = (events: string[], event: string) =>
  events.some((e) => e === '*' || e === event || e === `${event.split('.')[0]}.*`);

export interface WebhookEventInput {
  /** A name from WEBHOOK_EVENTS. */
  event: string;
  /** The payload's `data` (the fields the catalog documents). */
  data: Row;
  /** The record the event is about, when there is one (restriction and the payload's `record` come from it). */
  record?: { type: string; id: string } | null;
  /** The request that caused it, if a person did (for the payload's `actor`). */
  req?: FastifyRequest | null;
}

/**
 * A retention decision that changed a record outside the resource engine (E14-33): anonymized
 * (`row` is the record as it is now, `fields` the keys replaced) or removed for good (`row` is the
 * record as it was, used only for its restriction, id and reference: none of its values are sent).
 */
export interface RetentionChangeInput {
  action: 'anonymized' | 'deleted';
  def: ResourceDef;
  row: Row;
  /** Anonymized: the keys of the fields replaced (custom fields as `cf_<key>`). */
  fields?: string[];
  comments?: number;
  files?: number;
  req?: FastifyRequest | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Queues a catalog event for the webhooks that ask for it (core/webhooks.ts). Returns how many. */
    webhookEvent?: (input: WebhookEventInput) => Promise<number>;
    /** Queues the events of a retention decision (core/webhooks.ts, E14-33). Returns how many deliveries. */
    webhookRetentionChange?: (input: RetentionChangeInput) => Promise<number>;
  }
}

/**
 * Raises a catalog event for the webhooks that subscribe to it. Safe to call from any module: it
 * never throws (a failure is logged), does nothing when outbound connections are off, and does
 * nothing when the event's area is switched off.
 */
export async function emitWebhookEvent(app: FastifyInstance, input: WebhookEventInput): Promise<number> {
  if (typeof app.webhookEvent !== 'function') return 0;
  try {
    return await app.webhookEvent(input);
  } catch (err) {
    console.error('[webhooks] event not queued:', input.event, err);
    return 0;
  }
}

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
      // Only by explicit choice, and only while the person who made that choice still holds security.view.
      if (isRestricted(def, row) && !(await mayReceiveRestricted(hook))) continue;
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

  /** Whether a hook may receive something restricted: by explicit choice of someone who still holds security.view. */
  async function mayReceiveRestricted(hook: Row): Promise<boolean> {
    if (!hook.include_restricted) return false;
    const creator = hook.created_by ? await loadUser(db, hook.created_by) : null;
    return Boolean(creator && can(creator, 'security.view'));
  }

  // Events other than record changes (E13-19): the same switches, allow-list and restriction rules.
  async function emitEvent(input: WebhookEventInput): Promise<number> {
    const def = EVENT_DEFS.get(input.event);
    if (!def) throw new Error(`Unknown webhook event "${input.event}": add it to WEBHOOK_EVENTS first.`);
    if (!(await enabled())) return 0;
    if (def.area && !(await featureState(db)).on[def.area]) return 0;
    let restricted = def.restricted === 'always';
    let record: Row | null = null;
    if (input.record) {
      // Through the registry, which hides switched-off types: an event about one is not sent.
      const rdef = res.registry.get(input.record.type);
      if (!rdef) return 0;
      const row = await res.registry.find(input.record.type, input.record.id);
      if (!row) return 0;
      if (def.restricted === 'record' && isRestricted(rdef, row)) restricted = true;
      record = { type: rdef.type, id: row.id, ref: rdef.ref ? row[rdef.ref.field] ?? null : null, label: res.labelOf(rdef, row), route: `${rdef.route}/${row.id}` };
    }
    const hooks = await db.query<Row>('select * from webhooks where active and deleted_at is null');
    let queued = 0;
    for (const hook of hooks) {
      if (!matchesEvent(hook.events as string[], def.event)) continue;
      if (restricted && !(await mayReceiveRestricted(hook))) continue;
      await enqueue(hook, def.event, {
        event: def.event,
        occurredAt: new Date().toISOString(),
        record,
        data: input.data,
        actor: input.req?.user ? { id: input.req.user.id, name: input.req.user.displayName } : null,
      }, record?.type, record?.id);
      queued += 1;
    }
    if (queued && autoRun) setImmediate(() => { void processDue().catch((err) => console.error('[webhooks]', err)); });
    return queued;
  }
  if (!app.hasDecorator('webhookEvent')) app.decorate('webhookEvent', emitEvent);

  /**
   * A retention decision (E14-33): the record-change event (`<type>.update` with the replaced
   * fields only, or `<type>.delete`) for webhooks that follow the type, and the catalog event
   * (`retention.anonymized` or `retention.deleted`) for webhooks that ask for it. Neither carries
   * a value from before the change: an anonymized record's replaced fields are sent with their new
   * values, and a removed record is named by its type, id and reference only.
   */
  async function retentionChange(input: RetentionChangeInput): Promise<number> {
    if (!(await enabled())) return 0;
    const { def, row } = input;
    if (!res.registry.get(def.type)) return 0; // a switched-off type sends nothing
    const restricted = isRestricted(def, row);
    const ref = def.ref ? row[def.ref.field] ?? null : null;
    const anonymized = input.action === 'anonymized';
    const fields = anonymized ? [...new Set(input.fields ?? [])] : [];
    const record = anonymized
      ? { type: def.type, id: row.id, ref, label: res.labelOf(def, row), route: `${def.route}/${row.id}` }
      : { type: def.type, id: row.id, ref, label: ref, route: null };
    const now = new Date().toISOString();
    const actor = input.req?.user ? { id: input.req.user.id, name: input.req.user.displayName } : null;
    const replaced = Object.fromEntries(fields.map((k) => [k, k.startsWith(CUSTOM_PREFIX) ? (row.custom as Row | null)?.[k.slice(CUSTOM_PREFIX.length)] ?? null : row[k] ?? null]));
    const action = anonymized ? 'update' : 'delete';
    const catalog = anonymized ? 'retention.anonymized' : 'retention.deleted';
    const retention = { decision: input.action };
    const hooks = await db.query<Row>('select * from webhooks where active and deleted_at is null');
    let queued = 0;
    for (const hook of hooks) {
      const events = hook.events as string[];
      const asChange = matches(events, def.type, action);
      const asEvent = matchesEvent(events, catalog);
      if (!asChange && !asEvent) continue;
      if (restricted && !(await mayReceiveRestricted(hook))) continue;
      if (asChange) {
        await enqueue(hook, `${def.type}.${action}`, {
          event: `${def.type}.${action}`, occurredAt: now, record,
          data: anonymized ? replaced : {},
          ...(anonymized ? { changes: { fields, after: replaced } } : { purged: true }),
          retention, actor,
        }, def.type, row.id);
        queued += 1;
      }
      if (asEvent) {
        await enqueue(hook, catalog, {
          event: catalog, occurredAt: now, record,
          data: anonymized
            ? { recordType: def.type, fields, comments: input.comments ?? 0, files: input.files ?? 0 }
            : { recordType: def.type, purged: true },
          actor,
        }, def.type, row.id);
        queued += 1;
      }
    }
    if (queued && autoRun) setImmediate(() => { void processDue().catch((err) => console.error('[webhooks]', err)); });
    return queued;
  }
  if (!app.hasDecorator('webhookRetentionChange')) app.decorate('webhookRetentionChange', retentionChange);

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
    let secret: string;
    try {
      secret = open(d.webhook_id, d.secret);
    } catch {
      await finish('blocked', { error: 'The signing secret cannot be read with the current secret key. Replace the secret.' });
      return;
    }
    try {
      const response = await postWebhook(url, body, {
        'content-type': 'application/json', 'user-agent': 'grc-webhook/1',
        'x-grc-event': d.event, 'x-grc-delivery': d.id, 'x-grc-timestamp': timestamp,
        'x-grc-signature': signWebhook(secret, timestamp, body),
      }, await allowList());
      code = response.status;
      if (code < 200 || code >= 300) error = `The receiver answered ${code}.`;
    } catch (err) {
      if (err instanceof AddressBlockedError || (err as { code?: string })?.code === 'GRC_ADDRESS_BLOCKED') {
        await finish('blocked', { error: (err as Error).message });
        return;
      }
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
    if (running || inTrial()) return 0; // never deliver from inside a rolled-back check (E13-22)
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

  // Due deliveries are sent by a job-queue schedule set up by core in app.ts (E14-23); a new one is
  // also tried at once, except under test (tests call processDue themselves).
  const autoRun = !process.env.VITEST;

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
      else if (out.events.some((e: string) => !EVENT_RE.test(e) && !EVENT_DEFS.has(e))) {
        fields.events = 'Events look like "ticket.create", "ticket.*" or "*" (actions: create, update, delete), or a name from the list of other events.';
      } else {
        // A family of other events (`backup.*`) is known even where no record type has that name.
        const unknown = out.events.filter((e: string) => {
          if (e === '*' || EVENT_DEFS.has(e)) return false;
          const t = e.split('.')[0];
          return !res.registry.get(t) && !(EVENT_FAMILIES.has(t) && e === `${t}.*`);
        }).map((e: string) => e.split('.')[0]);
        if (unknown.length) fields.events = `Unknown record type: ${[...new Set(unknown)].join(', ')}.`;
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
    // Other events (E13-19), without those of a switched-off area.
    otherEvents: await offeredEvents(),
  }));

  async function offeredEvents() {
    const on = (await featureState(db)).on;
    return WEBHOOK_EVENTS.filter((e) => !e.area || on[e.area]).map(({ event, label, description, restricted, recordType, data }) =>
      ({ event, label, description, restricted, recordType: recordType ?? null, data }));
  }

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
