// Audit-log forwarding (E36-02): every audit event, in order, to a security monitoring system, as
// syslog (RFC 5424, over TLS or plain TCP, RFC 6587 octet counting) or as JSON lines over HTTPS.
//
// Fenced like webhooks: nothing is sent unless outbound connections are on
// (`integrations.outbound_enabled`), the forwarder is switched on (new ones are off), and its host is
// on `integrations.allowed_hosts`; every address the host resolves to is checked when connecting
// (checkedLookup: a private address only when listed exactly); TLS certificates are always verified
// (an extra certificate authority may be given for a private collector); HTTPS goes through the
// SSRF-safe client (postOutbound). Forwarded events carry no secret: values under secret-like keys
// are removed and webhook addresses shown as host and fingerprint (scrubEvent).
//
// Delivery: job `integrations.audit_forward` every minute (lane `integrations`). Per forwarder, one run
// at a time (claimed with `claimed_until`); events after the forwarder's cursor and older than five
// seconds (a slower transaction may commit a lower id late), 500 a batch; the cursor moves only after
// a batch is sent (compare-and-set). A failure keeps the cursor, is logged, and waits (60 seconds,
// doubling, at most an hour) before the next try.
import { X509Certificate, createHmac } from 'node:crypto';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { hostname as osHostname } from 'node:os';
import { connect as tlsConnect, rootCertificates } from 'node:tls';
import type { Db } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { RetryLaterError } from '../../core/jobs/index.ts';
import { secretBox } from '../../core/auth.ts';
import {
  AddressBlockedError, checkedLookup, hostAllowed, literalRefusal, postOutbound, redactWebhookAudit,
} from '../../core/webhooks.ts';

export const FORWARDER_KINDS = ['syslog_tls', 'syslog_tcp', 'https_json'] as const;
export type ForwarderKind = typeof FORWARDER_KINDS[number];
export const BATCH = 500;
const BATCHES_PER_RUN = 5;
const TIMEOUT_MS = 15_000;
/** Events younger than this are left for the next run (a slower transaction may commit a lower id late). Tests lower it. */
export const forwardTuning = { settleSeconds: 5 };
/** IANA's example enterprise number (RFC 5612), for the structured data id: no organization is named. */
const SD_ID = 'grc@32473';

export const forwarderUrlContext = (id: string) => `audit-forwarder-url:${id}`;
export const forwarderSecretContext = (id: string) => `audit-forwarder:${id}`;

// ---------- what is sent ----------

/** Keys whose values are never forwarded (secrets, hashes, sealed values). */
const SECRET_KEY = /(secret|password|passphrase|credential|private|^hash$|_hash$|^token$|access_token|refresh_token|id_token|sealed|recovery_codes|totp)/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, SECRET_KEY.test(k) && v !== null && v !== '' && v !== false ? '[removed]' : scrub(v, depth + 1)]));
}

/** An audit event as it is forwarded: no secret, webhook addresses as host and fingerprint only. */
export function scrubEvent(e: Row): Row {
  const webhook = String(e.action ?? '').startsWith('webhook.');
  const side = (v: unknown) => scrub(webhook ? redactWebhookAudit(v) : v);
  return {
    id: String(e.id),
    at: e.at instanceof Date ? e.at.toISOString() : String(e.at),
    action: e.action,
    actor: { id: e.actor_id ?? null, name: e.actor_name ?? null },
    ip: e.ip ?? null,
    record: e.record_type || e.record_id ? { type: e.record_type ?? null, id: e.record_id ?? null } : null,
    summary: e.summary ?? null,
    before: side(e.before ?? null),
    after: side(e.after ?? null),
    token: e.token_name ?? null,
    requestId: e.request_id ?? null,
  };
}

const ascii = (s: string, max: number) => (s.replace(/[^\x21-\x7e]/g, '_').slice(0, max) || '-');
const sdValue = (s: string) => s.replace(/[\\"\]]/g, (c) => `\\${c}`);
const hostnameOf = () => ascii(osHostname() || '-', 255);

/** One event as an RFC 5424 message: facility 13 (log audit), severity 6 (informational), JSON as the message. */
export function syslogLine(ev: Row, host = hostnameOf()): string {
  const sd = `[${SD_ID} eventId="${sdValue(String(ev.id))}" actor="${sdValue(String((ev.actor as Row)?.name ?? ''))}"${(ev.record as Row | null)?.type ? ` recordType="${sdValue(String((ev.record as Row).type))}"` : ''}]`;
  return `<110>1 ${ev.at} ${host} grc - ${ascii(String(ev.action ?? '-'), 32)} ${sd} ${JSON.stringify(ev)}`;
}

/** The bytes a batch is sent as: octet-counted syslog frames, or JSON lines. */
export function framed(events: Row[], format: string): string {
  if (format === 'json_lines') return events.map((e) => `${JSON.stringify(e)}\n`).join('');
  return events.map((e) => { const line = syslogLine(e); return `${Buffer.byteLength(line)} ${line}`; }).join('');
}

/** Whether an action is one a forwarder sends: no list = every action; `signin.` and `user.*` match a family. */
export function actionIncluded(action: string, include: unknown): boolean {
  if (!Array.isArray(include) || include.length === 0) return true;
  return include.some((raw) => {
    const p = String(raw);
    if (p.endsWith('*')) return action.startsWith(p.slice(0, -1));
    if (p.endsWith('.')) return action.startsWith(p);
    return action === p;
  });
}

// ---------- transport ----------

export interface Destination {
  kind: ForwarderKind;
  host: string;
  port: number | null;
  url: string | null;
  secret: string | null;
  ca: string | null;
  format: string;
}

/** Sends one batch, or throws. Every fence is checked here, at the moment of sending. */
export async function sendBatch(dest: Destination, events: Row[], allowList: unknown): Promise<void> {
  if (dest.kind === 'https_json') {
    let url: URL;
    try { url = new URL(dest.url ?? ''); } catch { throw new AddressBlockedError('The forwarding address is not a valid URL.'); }
    if (url.protocol !== 'https:') throw new AddressBlockedError('Audit events are sent over HTTPS only.');
    if (!hostAllowed(url, allowList)) throw new AddressBlockedError(`Host ${url.host} is not on the allow-list (integrations.allowed_hosts).`);
    const body = framed(events, 'json_lines');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = { 'content-type': 'application/x-ndjson', 'user-agent': 'grc-audit-forwarder/1', 'x-grc-timestamp': timestamp };
    if (dest.secret) {
      headers.authorization = `Bearer ${dest.secret}`;
      headers['x-grc-signature'] = `sha256=${createHmac('sha256', dest.secret).update(`${timestamp}.${body}`).digest('hex')}`;
    }
    const res = await postOutbound(url, body, headers, allowList, { timeoutMs: TIMEOUT_MS, ca: dest.ca });
    if (res.status < 200 || res.status >= 300) throw new Error(`The receiver answered ${res.status}.`);
    return;
  }
  const port = String(dest.port ?? (dest.kind === 'syslog_tls' ? 6514 : 514));
  const probe = new URL(`https://${dest.host.includes(':') && isIP(dest.host) === 6 ? `[${dest.host}]` : dest.host}:${port}`);
  if (!hostAllowed(probe, allowList)) throw new AddressBlockedError(`Host ${dest.host}:${port} is not on the allow-list (integrations.allowed_hosts).`);
  const blocked = literalRefusal(dest.host, port, allowList);
  if (blocked) throw blocked;
  await streamTo(dest, port, framed(events, dest.format), allowList);
}

function streamTo(dest: Destination, port: string, payload: string, allowList: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const lookup = checkedLookup(port, allowList);
    const host = dest.host.replace(/^\[|\]$/g, '');
    let socket: Socket;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { socket?.destroy(); reject(err); } else resolve();
    };
    const timer = setTimeout(() => finish(Object.assign(new Error(`No answer within ${TIMEOUT_MS / 1000} seconds.`), { name: 'TimeoutError' })), TIMEOUT_MS);
    timer.unref?.();
    const write = () => { socket.end(payload, 'utf8'); };
    if (dest.kind === 'syslog_tls') {
      socket = tlsConnect({
        host, port: Number(port), lookup, rejectUnauthorized: true,
        ...(isIP(host) ? {} : { servername: host }),
        ...(dest.ca ? { ca: [...rootCertificates, dest.ca] } : {}),
      }, write);
    } else {
      socket = netConnect({ host, port: Number(port), lookup }, write);
    }
    socket.on('error', (err) => finish(err));
    socket.on('close', (hadError) => { if (!hadError) finish(); });
  });
}

// ---------- the forwarders and the job ----------

export interface ForwardRun { forwarder: string; sent: number; status: 'sent' | 'idle' | 'skipped' | 'failed'; error?: string; waitSeconds?: number }

export function makeForwarding(ctx: Pick<ModuleContext, 'db' | 'settings' | 'audit'>) {
  const db: Db = ctx.db;
  const box = () => secretBox(db);
  const enabled = async () => (await ctx.settings.get<unknown>('integrations.outbound_enabled', false)) === true;
  const allowList = () => ctx.settings.get<unknown>('integrations.allowed_hosts', []);

  /** Where a forwarder sends, with its sealed values opened. Throws when they cannot be read. */
  function destination(f: Row): Destination {
    const open = (v: unknown, context: string) => (typeof v === 'string' && v ? box().decrypt(v, context) : null);
    return {
      kind: f.kind, host: String(f.host ?? ''), port: f.port ?? null,
      url: open(f.url_sealed, forwarderUrlContext(f.id)),
      secret: open(f.secret_sealed, forwarderSecretContext(f.id)),
      ca: f.ca_cert ?? null, format: f.kind === 'https_json' ? 'json_lines' : f.format,
    };
  }

  async function log(forwarderId: string, status: string, fields: { from?: unknown; to?: unknown; count?: number; error?: string | null }) {
    await db.query('insert into audit_forward_log (forwarder_id, from_id, to_id, count, status, error) values ($1,$2,$3,$4,$5,$6)',
      [forwarderId, fields.from ?? null, fields.to ?? null, fields.count ?? 0, status, fields.error ? fields.error.slice(0, 500) : null]);
  }

  const reason = (err: unknown) => {
    const e = err as Error & { code?: string };
    if (e?.name === 'TimeoutError') return e.message || 'No answer in time.';
    if (e instanceof AddressBlockedError || e?.code === 'GRC_ADDRESS_BLOCKED') return e.message;
    if (/certificate|self.signed|unable to verify|altnames|CERT_/i.test(`${e?.message} ${e?.code ?? ''}`)) {
      return `The receiver's TLS certificate was not accepted (${e.message}). Give its certificate authority if it is a private one.`;
    }
    return `Could not send: ${e?.message ?? String(err)}`;
  };

  /** Works on one forwarder: claims it, sends what is due, gives the claim back. */
  async function runOne(id: string): Promise<ForwardRun> {
    const claimed = await db.one<Row>(
      `update audit_forwarders set claimed_until = now() + interval '2 minutes'
       where id = $1 and active and deleted_at is null and (claimed_until is null or claimed_until < now())
         and (retry_at is null or retry_at <= now())
       returning *`, [id]);
    if (!claimed) return { forwarder: id, sent: 0, status: 'skipped' };
    let sent = 0;
    try {
      if (!(await enabled())) {
        await db.query('update audit_forwarders set last_error = $2 where id = $1', [id, 'Outbound connections are switched off (integrations.outbound_enabled).']);
        return { forwarder: id, sent: 0, status: 'skipped' };
      }
      const dest = destination(claimed);
      let cursor = String(claimed.cursor_id);
      for (let i = 0; i < BATCHES_PER_RUN; i++) {
        const events = await db.query<Row>(
          `select * from audit_events where id > $1::bigint and at < now() - make_interval(secs => $2::int) order by id limit ${BATCH}`,
          [cursor, forwardTuning.settleSeconds]);
        if (!events.length) break;
        const chosen = events.filter((e) => actionIncluded(String(e.action), claimed.include_actions)).map(scrubEvent);
        if (chosen.length) await sendBatch(dest, chosen, await allowList());
        const next = String(events[events.length - 1].id);
        const moved = await db.one(
          `update audit_forwarders set cursor_id = $2::bigint, last_success_at = now(), failures = 0, retry_at = null, last_error = null
           where id = $1 and cursor_id = $3::bigint returning 1`, [id, next, cursor]);
        if (!moved) break; // the cursor was moved elsewhere (an administrator restarted it): stop here
        await log(id, 'sent', { from: events[0].id, to: next, count: chosen.length });
        sent += chosen.length;
        cursor = next;
        if (events.length < BATCH) break;
      }
      return { forwarder: id, sent, status: sent ? 'sent' : 'idle' };
    } catch (err) {
      const error = reason(err);
      const row = await db.one<{ failures: number }>(
        `update audit_forwarders set failures = failures + 1, last_error = $2,
           retry_at = now() + make_interval(secs => least(3600, 60 * power(2, least(failures, 6)))::int)
         where id = $1 returning failures`, [id, error]);
      await log(id, 'failed', { from: claimed.cursor_id, error });
      return { forwarder: id, sent, status: 'failed', error, waitSeconds: Math.min(3600, 60 * 2 ** Math.min((row?.failures ?? 1) - 1, 6)) };
    } finally {
      await db.query('update audit_forwarders set claimed_until = null where id = $1', [id]);
    }
  }

  /** The job: every forwarder that is on. Throws RetryLaterError when one failed (it waits on its own). */
  async function runAll(): Promise<{ runs: ForwardRun[] }> {
    const ids = await db.query<{ id: string }>('select id from audit_forwarders where active and deleted_at is null order by created_at');
    const runs: ForwardRun[] = [];
    for (const { id } of ids) runs.push(await runOne(id));
    const failed = runs.filter((r) => r.status === 'failed');
    if (failed.length) {
      throw new RetryLaterError(`${failed.length} audit-log forwarder(s) could not send: ${failed.map((f) => f.error).join(' ')}`.slice(0, 500),
        Math.min(...failed.map((f) => f.waitSeconds ?? 60)));
    }
    return { runs };
  }

  /** One test event, sent now through the same fences. Moves no cursor. */
  async function test(f: Row): Promise<{ ok: boolean; error?: string }> {
    if (!(await enabled())) {
      const error = 'Outbound connections are switched off (integrations.outbound_enabled).';
      await log(f.id, 'test', { error });
      return { ok: false, error };
    }
    const ev = scrubEvent({ id: '0', at: new Date(), action: 'audit_forward.test', actor_name: 'System', summary: `Test event for forwarder "${f.name}"` });
    try {
      await sendBatch(destination(f), [ev], await allowList());
      await log(f.id, 'test', { count: 1 });
      return { ok: true };
    } catch (err) {
      const error = reason(err);
      await log(f.id, 'test', { error });
      return { ok: false, error };
    }
  }

  /** Removes delivery-log rows past `retention.audit_forward_log_days` (the forwarded events are not recalled). */
  async function housekeeping(): Promise<{ removed: number }> {
    const v = Number(await ctx.settings.get('retention.audit_forward_log_days', 30));
    const days = Number.isInteger(v) && v >= 1 && v <= 3650 ? v : 30;
    const removed = (await db.query('delete from audit_forward_log where attempted_at < now() - make_interval(days => $1::int) returning 1', [days])).length;
    if (removed) await ctx.audit(null, { action: 'retention.housekeeping', summary: `Audit-log forwarding log past its retention period removed: ${removed} row(s)` });
    return { removed };
  }

  return { runOne, runAll, test, housekeeping, destination };
}

/** Checks a PEM certificate authority given for a private collector. */
export function checkCa(pem: unknown): string | null | { error: string } {
  if (pem === undefined || pem === null || pem === '') return null;
  const s = String(pem).trim();
  if (s.length > 20_000 || !s.includes('-----BEGIN CERTIFICATE-----')) return { error: 'Paste one certificate in PEM form (-----BEGIN CERTIFICATE-----).' };
  try { new X509Certificate(s); } catch { return { error: 'That certificate could not be read.' }; }
  return s;
}
