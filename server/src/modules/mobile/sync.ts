// The mobile app's outbox on the server (wave 14, E38-10; spec §5.6): POST /api/mobile/sync and
// PUT /api/mobile/sync/attachment.
//
// Work saved on the phone (offline or not) waits in the app's outbox and is sent here in order. Each
// item carries a UUID the app made when the work was saved (`clientId`), which is its idempotency key:
// the answer is kept for SYNC_KEEP_DAYS (table mobile_sync_items), so an item sent again after a lost
// connection, a timeout or a restart is answered from memory and never done twice.
//
// Every item is done through the application's own routes, in-process, with the caller's own token
// (as GET /api/mobile/home reads them): validation, permissions, restrictions, hooks, notifications and
// audit are exactly the web's, and a refusal comes back with the route's own reason. Each item is
// answered separately: `done` (with what was made), `rejected` (the app keeps it in "Needs attention"
// with the reason) or `retry` (sent again later, unchanged). Items are done in order: after a `retry`
// the rest of the batch is not tried, so nothing overtakes the work it depends on.
//
// Extension point: a new kind of offline work (inspections, condition assessments, inventory counts)
// is one `defineSyncKind(app, { key, check, run })` call, plus the app's side (mobile/src/offline/kinds.ts).
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { clientIp } from '../../core/request.ts';
import {
  SYNC_KEEP_DAYS, SYNC_MAX_ITEMS, type SyncAnswer, type SyncRecordCreate, type SyncResult,
} from '../../../../shared/mobile-api.ts';
import { viaMobileToken } from './state.ts';

/** A row left `running` this long (the server stopped part-way) is answered "not sure it arrived". */
export const STALE_MS = 10 * 60_000;
/** Largest photo the attachment route takes into memory (the attachment limit applies first). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
/** The portal's report routes (people who report through the self-service portal), and the type each makes. */
export const PORTAL_PATHS: Record<string, string> = { '/api/portal/requests': 'ticket', '/api/portal/safety-reports': 'safety_event' };

/** An answer of an application route called in-process. */
export interface Called { status: number; body: any }

/** What a sync kind gets to do its work: the application's routes, as the caller. */
export interface SyncEnv {
  ctx: ModuleContext;
  req: FastifyRequest;
  /** Calls an /api route in-process as the caller (their token, their address). */
  call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, headers?: Record<string, string>): Promise<Called>;
  /** The record an earlier item of this person made (by its clientId), or null when it made none or is unknown. */
  madeBy(clientId: string): Promise<{ recordType: string; recordId: string } | null>;
}

/** What a kind's work came to: the route's answer, and (when it succeeded) what was made. */
export interface KindOutcome { status: number; body: any; result?: SyncResult }

export interface SyncKindDef {
  key: string;
  /** Checks and cleans the payload; returns a message when it cannot be done at all (the item is rejected). */
  check(payload: unknown, ctx: ModuleContext): Row | string;
  run(env: SyncEnv, payload: Row): Promise<KindOutcome>;
}

const kinds = new WeakMap<FastifyInstance, Map<string, SyncKindDef>>();

/** Adds a kind of outbox item (in `register`). Keys are `<thing>.<action>` and unique. */
export function defineSyncKind(app: FastifyInstance, def: SyncKindDef): void {
  if (!/^[a-z][a-z_]*(\.[a-z_]+)*$/.test(def.key)) throw new Error(`Bad sync kind key: ${def.key}`);
  let map = kinds.get(app);
  if (!map) kinds.set(app, (map = new Map()));
  if (map.has(def.key)) throw new Error(`Sync kind defined twice: ${def.key}`);
  map.set(def.key, def);
}
export const syncKinds = (app: FastifyInstance) => [...(kinds.get(app)?.keys() ?? [])].sort();

/** JSON with object keys sorted, so the same content always has the same fingerprint. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Row).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Row)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
const fingerprintOf = (kind: string, content: string | Buffer) => createHash('sha256').update(`${kind}\n`).update(content).digest('hex');

const errorOf = (body: any, status: number): NonNullable<SyncAnswer['error']> => {
  const e = body?.error;
  const out: NonNullable<SyncAnswer['error']> = {
    code: typeof e?.code === 'string' ? e.code : `http_${status}`,
    message: typeof e?.message === 'string' ? e.message : typeof e === 'string' ? e : 'The server could not do this.',
  };
  if (e?.fields && typeof e.fields === 'object' && Object.keys(e.fields).length) out.fields = e.fields;
  return out;
};

/** Whether a refusal may pass if the same item is simply sent again later. */
export function isTransient(status: number, code: string): boolean {
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500 || code === 'idempotency_in_progress';
}

export const UNCERTAIN = {
  code: 'uncertain',
  message: 'The server stopped while doing this, so it may or may not have been saved. Check on the web, then send it again or discard it.',
};

/** Calls an /api route in-process as the person behind the request (their token, their address). */
export function callAs(app: FastifyInstance, req: FastifyRequest): SyncEnv['call'] {
  return async (method, url, body, headers = {}) => {
    const h: Record<string, string> = { accept: 'application/json', ...headers };
    if (req.headers.authorization) h.authorization = String(req.headers.authorization);
    let payload: string | Buffer | undefined;
    if (Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await app.inject({ method, url, headers: h, payload, remoteAddress: clientIp(req) });
    let parsed: any = null;
    try { parsed = res.body ? res.json() : null; } catch { parsed = null; }
    return { status: res.statusCode, body: parsed };
  };
}

export function registerSync(ctx: ModuleContext) {
  const { app, db } = ctx;

  function envFor(req: FastifyRequest): SyncEnv {
    const me = req.user!;
    return {
      ctx, req,
      call: callAs(app, req),
      async madeBy(clientId) {
        if (!UUID_RE.test(clientId)) return null;
        const row = await db.one<Row>(
          `select record_type, record_id from mobile_sync_items where user_id = $1 and client_id = $2 and state = 'done' and record_id is not null`,
          [me.id, clientId.toLowerCase()]);
        return row ? { recordType: row.record_type, recordId: row.record_id } : null;
      },
    };
  }

  /**
   * Does one item at most once: claims its id, does the work, keeps the answer. The same id again
   * (also while the first is still running) never does the work twice.
   */
  async function once(req: FastifyRequest, clientId: string, kind: string, fingerprint: string, work: () => Promise<KindOutcome>): Promise<SyncAnswer> {
    const me = req.user!;
    const id = clientId.toLowerCase();
    await db.query('delete from mobile_sync_items where expires_at < now()');
    const claimed = await db.one<{ id: string }>(
      `insert into mobile_sync_items (user_id, device_id, client_id, kind, fingerprint, state, expires_at)
       values ($1, $2, $3, $4, $5, 'running', now() + make_interval(days => $6::int))
       on conflict (user_id, client_id) do nothing returning id`,
      [me.id, req.apiToken!.id, id, kind, fingerprint, SYNC_KEEP_DAYS]);
    if (!claimed) {
      const prior = await db.one<Row>('select * from mobile_sync_items where user_id = $1 and client_id = $2', [me.id, id]);
      if (!prior) return { clientId, status: 'retry', error: { code: 'idempotency_in_progress', message: 'This is still being saved. It is sent again shortly.' } };
      if (prior.kind !== kind || prior.fingerprint !== fingerprint) {
        return { clientId, status: 'rejected', error: { code: 'idempotency_key_reused', message: 'Something different was already sent with this id. Send it as new work.' } };
      }
      if (prior.state === 'done') return { ...(prior.answer as SyncAnswer), clientId, replayed: true };
      if (Date.now() - new Date(prior.created_at).getTime() < STALE_MS) {
        return { clientId, status: 'retry', error: { code: 'idempotency_in_progress', message: 'This is still being saved. It is sent again shortly.' } };
      }
      return { clientId, status: 'rejected', error: { ...UNCERTAIN } };
    }

    let outcome: KindOutcome;
    try {
      outcome = await work();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (!err) console.error(`[mobile.sync] ${kind} ${id}:`, e);
      outcome = { status: err?.status ?? 500, body: { error: { code: err?.code ?? 'server_error', message: err?.message ?? 'Something went wrong. The error has been logged.', fields: err?.fields } } };
    }
    if (outcome.status >= 200 && outcome.status < 300) {
      const answer: SyncAnswer = { clientId, status: 'done', result: outcome.result ?? {} };
      await db.query(
        `update mobile_sync_items set state = 'done', answer = $2, record_type = $3, record_id = $4, finished_at = now() where id = $1`,
        [claimed.id, JSON.stringify(answer), outcome.result?.recordType ?? null, outcome.result?.id && UUID_RE.test(outcome.result.id) ? outcome.result.id : null]);
      return answer;
    }
    // Not done: nothing is kept, so the same item may be sent again (as it is, or corrected).
    await db.query('delete from mobile_sync_items where id = $1', [claimed.id]);
    const error = errorOf(outcome.body, outcome.status);
    return { clientId, status: isTransient(outcome.status, error.code) ? 'retry' : 'rejected', error };
  }

  const mobileOnly = (req: FastifyRequest) => {
    if (!viaMobileToken(req)) ctx.fail(403, 'mobile_app_only', 'Only the mobile app sends its outbox here.');
  };

  // ---------- the batch ----------

  app.post('/api/mobile/sync', async (req) => {
    mobileOnly(req);
    const items = (req.body as Row | undefined)?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > SYNC_MAX_ITEMS) {
      ctx.fail(400, 'validation', `Send 1 to ${SYNC_MAX_ITEMS} items.`);
    }
    const env = envFor(req);
    const map = kinds.get(app) ?? new Map<string, SyncKindDef>();
    const out: SyncAnswer[] = [];
    let stop: SyncAnswer['error'] | null = null;
    for (const raw of items as Row[]) {
      const clientId = typeof raw?.clientId === 'string' ? raw.clientId : '';
      if (stop) { out.push({ clientId, status: 'retry', error: stop }); continue; }
      if (!UUID_RE.test(clientId)) { out.push({ clientId, status: 'rejected', error: { code: 'bad_item', message: 'This item has no valid id.' } }); continue; }
      const def = map.get(String(raw.kind));
      if (!def) {
        out.push({ clientId, status: 'rejected', error: { code: 'unknown_kind', message: 'This server does not know this kind of work. Update the server or finish it on the web.' } });
        continue;
      }
      const checked = def.check(raw.payload, ctx);
      if (typeof checked === 'string') { out.push({ clientId, status: 'rejected', error: { code: 'bad_item', message: checked } }); continue; }
      const answer = await once(req, clientId, def.key, fingerprintOf(def.key, stableJson(checked)), () => def.run(env, checked));
      out.push(answer);
      if (answer.status === 'retry') stop = { code: 'not_tried', message: 'Waiting for earlier work to be sent first.' };
    }
    return { items: out };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/mobile/sync', tag: 'Mobile app',
    summary: 'The mobile app\'s outbox: work saved on the phone, done in order, each item at most once',
    description: `The app's token only (403 \`mobile_app_only\` otherwise). Up to ${SYNC_MAX_ITEMS} items, each with a client-made UUID that is its idempotency key, kept ${SYNC_KEEP_DAYS} days: the same item sent again is answered from memory (\`replayed\`). Each item is done through the application's own route as you, and answered separately: \`done\`, \`rejected\` (with the route's reason) or \`retry\`; after a \`retry\` the rest of the batch is not tried. Kinds: \`record.create\` ({ path, recordType, body, link? }).`,
    body: 'SyncRequest: { items: [{ clientId, kind, payload }] }',
    response: 'SyncResponse: { items: [{ clientId, status: done|rejected|retry, replayed?, result?: { recordType, id, ref, linked?, warning? }, error?: { code, message, fields? } }] }',
  });

  // ---------- photos and other files ----------

  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

    scoped.put('/api/mobile/sync/attachment', async (req) => {
      mobileOnly(req);
      const q = (req.query ?? {}) as Record<string, string>;
      const key = req.headers['idempotency-key'];
      const clientId = String(q.clientId ?? key ?? '');
      if (!UUID_RE.test(clientId) || (key !== undefined && String(key).toLowerCase() !== clientId.toLowerCase())) {
        ctx.fail(400, 'bad_idempotency_key', 'Send the photo\'s own id (a UUID) as clientId and as the Idempotency-Key.');
      }
      const name = String(q.name ?? '').trim();
      if (!name) ctx.fail(400, 'validation', 'Send the file name.', { name: 'Required.' });
      const stream = req.body as Readable | undefined;
      if (!stream || typeof stream.pipe !== 'function') ctx.fail(415, 'unsupported_media_type', 'Send the file as the request body with the content type application/octet-stream.');

      // The whole file arrives before anything is done: a connection lost during the upload does nothing.
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream!) {
        size += (chunk as Buffer).length;
        if (size > MAX_ATTACHMENT_BYTES) {
          stream!.resume();
          return { clientId, status: 'rejected', error: { code: 'too_large', message: 'This file is larger than the app may send.' } } satisfies SyncAnswer;
        }
        chunks.push(chunk as Buffer);
      }
      const bytes = Buffer.concat(chunks);
      const target = q.parent ? `parent:${String(q.parent).toLowerCase()}` : `record:${q.record_type}:${String(q.record_id ?? '').toLowerCase()}`;
      const fingerprint = fingerprintOf('attachment', Buffer.concat([Buffer.from(`${target}\n${name}\n${q.description ?? ''}\n`), bytes]));
      const env = envFor(req);
      return once(req, clientId, 'attachment', fingerprint, async () => {
        let recordType = String(q.record_type ?? '');
        let recordId = String(q.record_id ?? '');
        if (q.parent) {
          const made = await env.madeBy(String(q.parent));
          if (!made) return { status: 409, body: { error: { code: 'parent_missing', message: 'The report this photo belongs to has not arrived. Send the report first.' } } };
          recordType = made.recordType; recordId = made.recordId;
        }
        if (!recordType || !UUID_RE.test(recordId)) return { status: 400, body: { error: { code: 'validation', message: 'Say which record the photo belongs to.' } } };
        const params = new URLSearchParams({ record_type: recordType, record_id: recordId, name });
        if (q.description) params.set('description', String(q.description));
        const res = await env.call('PUT', `/api/attachments/upload?${params}`, bytes, { 'content-type': 'application/octet-stream' });
        return { ...res, result: res.status < 300 ? { recordType, id: recordId, attachmentId: res.body?.id, fileName: res.body?.file_name } : undefined };
      });
    });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/mobile/sync/attachment', tag: 'Mobile app',
    summary: 'A photo from the mobile app\'s outbox, attached at most once to a record (or to the record an earlier outbox item made)',
    description: `The app's token only. Header \`Idempotency-Key\` and query \`clientId\`: the photo's own UUID, kept ${SYNC_KEEP_DAYS} days. \`parent\` is the clientId of a done \`record.create\` item (or give \`record_type\` and \`record_id\`). The whole file is received before anything is done; it is then attached through PUT /api/attachments/upload as you, with its limits, checks and audit. Answers a SyncAnswer (status 200).`,
    query: { clientId: 'The photo\'s UUID', parent: 'clientId of the item that made the record', record_type: 'Or: the record type', record_id: 'and the record id', name: 'File name', description: 'Optional description' },
    body: 'The file (application/octet-stream)',
    response: 'SyncAnswer: { clientId, status, replayed?, result?: { recordType, id, attachmentId, fileName }, error? }',
  });

  // ---------- built-in kinds ----------

  defineSyncKind(app, {
    key: 'record.create',
    check(payload, c) {
      const p = (payload ?? {}) as Partial<SyncRecordCreate>;
      if (typeof p.path !== 'string' || typeof p.recordType !== 'string' || !p.body || typeof p.body !== 'object' || Array.isArray(p.body)) {
        return 'This report is incomplete.';
      }
      const portalType = PORTAL_PATHS[p.path];
      const def = portalType ? null : c.resources.all().find((d) => d.path === p.path);
      if (portalType ? portalType !== p.recordType : def?.type !== p.recordType) return 'This kind of record cannot be made from the app.';
      const link = p.link && typeof p.link === 'object' && typeof p.link.type === 'string' && typeof p.link.id === 'string' ? { type: p.link.type, id: p.link.id } : null;
      return { path: p.path, recordType: p.recordType, body: p.body, link };
    },
    async run(env, p) {
      const made = await env.call('POST', p.path, p.body);
      if (made.status < 200 || made.status >= 300) return made;
      const result: SyncResult = { recordType: p.recordType, id: String(made.body?.id ?? ''), ref: made.body?.ref ?? null };
      if (p.link) {
        const linked = await env.call('POST', '/api/links', { from_type: p.recordType, from_id: result.id, to_type: p.link.type, to_id: p.link.id });
        result.linked = linked.status >= 200 && linked.status < 300;
        if (!result.linked) result.warning = `Saved, but not linked to the record it was about: ${errorOf(linked.body, linked.status).message}`;
      }
      return { ...made, result };
    },
  });

  return {
    /** Daily: answers older than SYNC_KEEP_DAYS go. */
    async cleanup() {
      return (await db.query('delete from mobile_sync_items where expires_at < now() returning id')).length;
    },
  };
}
