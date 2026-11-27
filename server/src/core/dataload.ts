import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.ts';
import type { SessionUser } from './module.ts';
import { can } from './services.ts';
import { tokenOwnerPermissions, tokenScopes } from './tokens.ts';

/**
 * Data load mode (E18-70): for loading historical records, for example a service desk's past
 * tickets with their original opened, resolved and closed times. Off by default. An administrator
 * switches it on (Administration > Settings, with a recent password confirmation) until a time at
 * most `DATA_LOAD_MAX_DAYS` ahead; it switches itself off then.
 *
 * While it is on, a save by someone holding `admin.administer` (also with their API and MCP tokens,
 * when the token's owner holds it; an MCP token also needs `mcp.write_enabled`) is a *load*:
 * - every field may be set, read-only ones included, and `created_at`, `created_by`, `updated_at`
 *   and the reference; the status skips lifecycle and module step rules (resource engine);
 * - values the caller gave win over what module hooks would work out (`ctx.loading`/`isDataLoad`);
 * - nothing is sent: notifications, email, text messages, push, webhooks, approvals and outside
 *   work trackers stay quiet (`inDataLoad()`); the search index is kept as usual;
 * - each new record is listed in `data_load_records`, so the load can be undone;
 * - its audit events carry the marker "(data load)".
 * Type validation, list values, references, required fields, If-Match, restricted records and
 * legal holds apply as always.
 */

export const DATA_LOAD_KEY = 'data_load.mode';
export const DATA_LOAD_MAX_DAYS = 30;
export const DATA_LOAD_DEFAULT_DAYS = 7;
/** The fields every record has that a load may set too. */
export const DATA_LOAD_STD_FIELDS = ['created_at', 'created_by', 'updated_at'] as const;

export interface DataLoadState {
  on: boolean;
  /** ISO time it switches itself off. */
  until: string | null;
  startedAt: string | null;
  startedBy: string | null;
}
const OFF: DataLoadState = { on: false, until: null, startedAt: null, startedBy: null };

declare module 'fastify' {
  interface FastifyRequest {
    /** True once a save in this request has been found to be a data load (E18-70, core/dataload.ts). */
    dataLoad: boolean;
  }
}

// ---------- quiet work ----------

const quiet = new AsyncLocalStorage<{ load: true }>();

/** True inside work done as a data load: senders (notify, mail, texts, push, webhooks, trackers, approvals) do nothing. */
export const inDataLoad = (): boolean => quiet.getStore() !== undefined;

/** Runs `fn` as a data load: nothing it causes, after its commit included, is sent anywhere. */
export const asDataLoad = <T>(fn: () => Promise<T>): Promise<T> => quiet.run({ load: true }, fn);

/** For module hooks: this save is a data load, so supplied values win and nothing is sent. */
export const isDataLoad = (req: FastifyRequest | null | undefined): boolean => req?.dataLoad === true || inDataLoad();

// ---------- the switch ----------

const parse = (value: unknown): DataLoadState => {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const until = typeof v?.until === 'string' ? v.until : null;
  if (!until || Number.isNaN(Date.parse(until))) return OFF;
  return { on: true, until, startedAt: typeof v?.startedAt === 'string' ? v.startedAt : null, startedBy: typeof v?.startedBy === 'string' ? v.startedBy : null };
};

type AuditFn = (req: FastifyRequest | null, ev: { action: string; recordType?: string; recordId?: string; summary?: string; before?: unknown; after?: unknown }) => Promise<void>;

/**
 * The mode as it is now. Past its end time it is switched off here (and audited once), so it never
 * outlives its end even between two runs of the job `core.data_load_expiry`.
 */
export async function readDataLoad(db: Queryable, audit?: AuditFn): Promise<DataLoadState> {
  const row = await db.one<{ value: unknown }>('select value from settings where key = $1', [DATA_LOAD_KEY]);
  const state = parse(row?.value);
  if (!state.on || Date.parse(state.until!) > Date.now()) return state;
  const ended = await db.one<{ key: string }>(
    `delete from settings where key = $1 and value->>'until' = $2 returning key`, [DATA_LOAD_KEY, state.until]);
  if (ended && audit) {
    await audit(null, {
      action: 'data_load.end', recordType: 'setting', recordId: DATA_LOAD_KEY,
      summary: `Data load mode switched itself off at its end time (${state.until})`, before: state, after: null,
    });
  }
  return OFF;
}

/** The owner's own grants for a token request, the person's for a session. */
function ownGrants(req: FastifyRequest): string[] {
  if (!req.apiToken) return req.user?.permissions ?? [];
  return tokenOwnerPermissions(req) ?? [];
}

/** Whether this person (or token owner) may load: holds `admin.administer`. */
export function mayLoad(req: FastifyRequest): boolean {
  if (!req.user) return false;
  return can({ ...req.user, permissions: ownGrants(req) } as SessionUser, 'admin.administer');
}

const isMcpToken = (req: FastifyRequest) => {
  const scopes = tokenScopes(req) ?? [];
  return scopes.includes('mcp.use') || scopes.includes('mcp.*');
};

/**
 * Whether a save made by this request is a data load: the mode is on, the person (or the token's
 * owner) holds `admin.administer`, and an MCP token also has AI assistant write access switched on.
 */
export async function dataLoadFor(db: Queryable, req: FastifyRequest | null, audit?: AuditFn): Promise<boolean> {
  if (!req?.user) return false;
  if (req.dataLoad) return true;
  if (!mayLoad(req)) return false;
  if (!(await readDataLoad(db, audit)).on) return false;
  if (req.apiToken && isMcpToken(req)) {
    const w = await db.one<{ value: unknown }>(`select value from settings where key = 'mcp.write_enabled'`);
    if (w?.value !== true) return false;
  }
  return true;
}

/** Lists a record created by a load, so the load can be undone. */
export async function noteLoaded(db: Queryable, type: string, id: string, req: FastifyRequest | null): Promise<void> {
  await db.query(
    `insert into data_load_records (record_type, record_id, loaded_by, token_id, token_name) values ($1, $2, $3, $4, $5)
     on conflict (record_type, record_id) do nothing`,
    [type, id, req?.user?.id ?? null, req?.apiToken?.id ?? null, req?.apiToken?.name ?? null]);
}

/** Whether a record was created by a load and not yet deleted. */
export async function wasLoaded(db: Queryable, type: string, id: string): Promise<boolean> {
  return !!(await db.one('select 1 from data_load_records where record_type = $1 and record_id = $2 and deleted_at is null', [type, id]));
}

/**
 * Keeps the senders quiet during a load (E18-70): `notify`, `sendMail`, `sendText` and `pushNotify`
 * do nothing inside `asDataLoad`. Called once every module has registered, so it wraps whatever
 * each decorator is (a test's stand-in included).
 */
export function quietSenders(app: FastifyInstance): void {
  const quietValue: Record<string, unknown> = {
    notify: { sent: 0, skipped: 0 },
    sendMail: { queued: 0, skipped: 0, enabled: false, logIds: [] },
    sendText: { queued: 0, skipped: 0, logIds: [] },
    pushNotify: undefined,
  };
  for (const name of Object.keys(quietValue)) {
    if (!app.hasDecorator(name)) continue;
    const target = app as unknown as Record<string, unknown>;
    const original = target[name];
    if (typeof original !== 'function' || (original as { quietInLoad?: boolean }).quietInLoad) continue;
    const wrapped = async function quietWhileLoading(this: unknown, ...args: unknown[]) {
      if (inDataLoad()) return quietValue[name];
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    (wrapped as { quietInLoad?: boolean }).quietInLoad = true;
    target[name] = wrapped;
  }
}

export type { Db };
