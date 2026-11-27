import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db, Queryable } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
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
 *
 * Acting on behalf of someone (E18-71): during a load the person who wrote or did something may be
 * named, with `on_behalf_of` in a JSON body or the `X-On-Behalf-Of` header (file uploads): an
 * account (user id, username or email; disabled accounts too), a roster person (people module), or
 * a plain name. Records, comments, links, files and approval decisions then carry that person as
 * their author; the audit log keeps the real actor (the administrator and their token) and adds
 * "on behalf of <person>". Outside a load naming another person is refused (400). Permissions are
 * the loader's own; nothing is sent to the named person.
 */

export const DATA_LOAD_KEY = 'data_load.mode';
export const DATA_LOAD_MAX_DAYS = 30;
export const DATA_LOAD_DEFAULT_DAYS = 7;
/** The fields every record has that a load may set too. */
export const DATA_LOAD_STD_FIELDS = ['created_at', 'created_by', 'updated_at', 'updated_by'] as const;

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
    /** The person a load names as the author of this request's work (E18-71), or null. */
    onBehalf: ActingPerson | null;
  }
}

/**
 * The person a load writes in the name of (E18-71). `userId` is their account (null for a roster
 * person without one, or a plain name); `personId` their roster entry, when named that way.
 */
export interface ActingPerson {
  kind: 'user' | 'person' | 'name';
  userId: string | null;
  personId: string | null;
  name: string;
}

// ---------- quiet work ----------

const quiet = new AsyncLocalStorage<{ load: true; onBehalf?: ActingPerson | null }>();

/** True inside work done as a data load: senders (notify, mail, texts, push, webhooks, trackers, approvals) do nothing. */
export const inDataLoad = (): boolean => quiet.getStore() !== undefined;

/** Runs `fn` as a data load: nothing it causes, after its commit included, is sent anywhere. */
export const asDataLoad = <T>(fn: () => Promise<T>): Promise<T> => quiet.run({ ...quiet.getStore(), load: true }, fn);

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
    `insert into data_load_records (record_type, record_id, loaded_by, token_id, token_name, on_behalf_name) values ($1, $2, $3, $4, $5, $6)
     on conflict (record_type, record_id) do nothing`,
    [type, id, req?.user?.id ?? null, req?.apiToken?.id ?? null, req?.apiToken?.name ?? null, onBehalfOf(req)?.name ?? null]);
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

// ---------- acting on behalf of someone (E18-71) ----------

/** The JSON body field that names the author of a load's work. */
export const ON_BEHALF_FIELD = 'on_behalf_of';
/** The same as a header, for requests without a JSON body (file uploads). */
export const ON_BEHALF_HEADER = 'x-on-behalf-of';
const NAME_MAX = 200;

const fieldError = (field: string, message: string): never => fail(400, 'validation', 'Check the highlighted fields.', { [field]: message });

/**
 * An account by user id, username or email, disabled ones included (a removed account by its id
 * only). Undefined when none matches.
 */
export async function findAccount(db: Queryable, key: string): Promise<{ id: string; display_name: string } | undefined> {
  const k = key.trim();
  if (!k) return undefined;
  if (UUID_RE.test(k)) return db.one('select id, display_name from users where id = $1', [k]);
  return db.one(
    `select id, display_name from users where deleted_at is null and (lower(username) = lower($1) or lower(email) = lower($1))
     order by (lower(username) = lower($1)) desc limit 1`, [k]);
}

/** Roster people (people module, when installed) by id, reference, email or employee number: at most two. */
async function findRosterPeople(db: Queryable, key: string): Promise<{ id: string; full_name: string; user_id: string | null }[]> {
  const k = key.trim();
  if (!k) return [];
  const table = await db.one<{ t: string | null }>(`select to_regclass('people')::text as t`);
  if (!table?.t) return [];
  if (UUID_RE.test(k)) return db.query('select id, full_name, user_id from people where id = $1 and deleted_at is null', [k]);
  return db.query(
    `select id, full_name, user_id from people where deleted_at is null
       and (lower(coalesce(ref, '')) = lower($1) or lower(coalesce(email, '')) = lower($1) or lower(coalesce(employee_number, '')) = lower($1))
     order by full_name limit 2`, [k]);
}

const KEYS: Record<string, 'user' | 'person' | 'name'> = {
  user: 'user', user_id: 'user', username: 'user', email: 'user', person: 'person', person_id: 'person', name: 'name',
};

/**
 * Works out the person a load names (E18-71). Accepted:
 * - a string: an account's user id, username or email (disabled accounts too); failing that a roster
 *   person's id, reference, email or employee number; `user:<...>` and `person:<...>` ask for one of
 *   the two only; `name:<display name>` is a plain name for someone with neither;
 * - an object with one of `user` (or `user_id`, `username`, `email`), `person` (or `person_id`) or `name`.
 * Anything else, or nobody found, is a 400 field error on `field`: it never falls back to the loader.
 */
export async function resolvePerson(db: Queryable, value: unknown, field = ON_BEHALF_FIELD): Promise<ActingPerson> {
  let want: 'any' | 'user' | 'person' | 'name' = 'any';
  let key = '';
  if (typeof value === 'string') {
    key = value.trim();
    const prefix = /^(user|person|name):\s*/i.exec(key);
    if (prefix) {
      want = prefix[1].toLowerCase() as 'user' | 'person' | 'name';
      key = key.slice(prefix[0].length).trim();
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length !== 1 || !KEYS[entries[0][0]] || typeof entries[0][1] !== 'string') {
      fieldError(field, 'Name one person: {"user": id, username or email}, {"person": roster id or email} or {"name": "their name"}.');
    }
    want = KEYS[entries[0][0]];
    key = String(entries[0][1]).trim();
  } else {
    fieldError(field, 'Name a person: a user id, username or email, a roster person, or "name:<their name>".');
  }
  if (!key) fieldError(field, 'Name a person.');
  if (want === 'name') {
    if (key.length > NAME_MAX) fieldError(field, `A name has at most ${NAME_MAX} characters.`);
    return { kind: 'name', userId: null, personId: null, name: key };
  }
  if (want !== 'person') {
    const account = await findAccount(db, key);
    if (account) return { kind: 'user', userId: account.id, personId: null, name: account.display_name };
    if (want === 'user') fieldError(field, `No account has the user id, username or email "${key}".`);
  }
  const people = await findRosterPeople(db, key);
  if (people.length > 1) fieldError(field, `More than one roster person matches "${key}": give the person's id.`);
  if (people.length === 1) {
    const p = people[0];
    return { kind: 'person', userId: p.user_id ?? null, personId: p.id, name: p.full_name };
  }
  return fieldError(field, want === 'person'
    ? `No roster person has the id, reference, email or employee number "${key}".`
    : `No account or roster person matches "${key}". For someone with neither, give "name:${key}".`);
}

/** The person this request's (or this load's) work is written in the name of, if one was named. */
export const onBehalfOf = (req?: FastifyRequest | null): ActingPerson | null => req?.onBehalf ?? quiet.getStore()?.onBehalf ?? null;

/** " on behalf of <name>" for summaries, or "" when nobody was named. */
export const onBehalfText = (req?: FastifyRequest | null): string => {
  const ob = onBehalfOf(req);
  return ob ? ` on behalf of ${ob.name}` : '';
};

/**
 * Who to record as the author or actor of something (E18-71): the person a load names, otherwise
 * the signed-in person. `id` is null for a person without an account. For modules that store an
 * actor in their own columns (`decided_by`, `recorded_by`, ...); the audit log keeps the real one.
 */
export function actorOf(req?: FastifyRequest | null): { id: string | null; name: string | null } {
  const ob = onBehalfOf(req);
  if (ob) return { id: ob.userId, name: ob.name };
  return { id: req?.user?.id ?? null, name: req?.user?.displayName ?? null };
}

const decodeHeader = (v: string): string => {
  if (!/%[0-9a-f]{2}/i.test(v)) return v;
  try { return decodeURIComponent(v); } catch { return v; }
};

/**
 * Reads `on_behalf_of` (JSON body) or `X-On-Behalf-Of` (header) on every change request (E18-71).
 * Only a data load may name someone: otherwise 400 `on_behalf_not_allowed`. The person is resolved
 * (an unknown one is a field error), the request is a load from then on, and the rest of it runs
 * quietly with the person known to every layer (`onBehalfOf`, `actorOf`). The field is taken out
 * of the body, so routes never see it as one of theirs.
 */
export function registerOnBehalf(app: FastifyInstance, db: Queryable, audit?: AuditFn): void {
  if (!app.hasRequestDecorator('onBehalf')) app.decorateRequest('onBehalf', null);
  app.addHook('preValidation', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) && !Buffer.isBuffer(req.body)
      ? req.body as Record<string, unknown> : null;
    const header = req.headers[ON_BEHALF_HEADER];
    let raw: unknown = Array.isArray(header) ? header[0] : header;
    if (typeof raw === 'string') raw = decodeHeader(raw);
    if (body && ON_BEHALF_FIELD in body) {
      const given = body[ON_BEHALF_FIELD];
      delete body[ON_BEHALF_FIELD];
      if (given !== undefined && given !== null && given !== '') raw = given;
    }
    if (raw === undefined || raw === null || raw === '') return;
    if (!req.user) return; // the route refuses the request itself
    if (!(await dataLoadFor(db, req, audit))) {
      fail(400, 'on_behalf_not_allowed', 'Another person can be named as the author only in data load mode, by an administrator.',
        { [ON_BEHALF_FIELD]: 'Only in data load mode (Administration > Settings), by an administrator.' });
    }
    req.onBehalf = await resolvePerson(db, raw);
    req.dataLoad = true;
  });
  // The rest of the request runs as a quiet load that knows the person (a callback hook, so the
  // handler runs inside that context).
  app.addHook('preValidation', (req, _reply, done) => {
    if (req.onBehalf) quiet.run({ load: true, onBehalf: req.onBehalf }, done);
    else done();
  });
}

export type { Db };
