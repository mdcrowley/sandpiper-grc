import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { parseDate } from '../../core/import/service.ts';
import { ImportFileError, readUpload } from '../../core/import/read.ts';
import { UUID_RE } from '../../core/errors.ts';

/**
 * The register of accounts on each system (E41-02): one record per account a system knows, with its
 * holder, the role it has there and when it was last used. Accounts are entered by hand or imported
 * from a file per system (`POST /api/system-accounts/import`). Holders are matched to the staff roster
 * (the people module, read only) by employee number, then email, then an exact and unique name; a
 * holder chosen by hand is kept. An active personal account whose holder has left, is on leave or is
 * not on the roster is flagged (`attention`), worked out on every save, whenever a person on the roster
 * changes, and daily. Shares the `systems` permissions; feature area `accessreviews`.
 */

export const ATTENTION = ['leaver', 'on_leave', 'unmatched'] as const;
export type Attention = (typeof ATTENTION)[number] | null;

/** Statuses of `person_status` that mean the person has left (meta.final), and the on-leave value. */
async function personMeanings(ctx: ModuleContext): Promise<{ left: string[]; leave: string[] }> {
  const values = await ctx.lookups.values('person_status');
  const left = values.filter((v) => v.meta?.final === true).map((v) => v.value);
  const leave = values.filter((v) => v.value === 'on_leave' || v.meta?.leave === true).map((v) => v.value);
  return { left: left.length ? left : ['left'], leave: leave.length ? leave : ['on_leave'] };
}

const rosterOn = (ctx: ModuleContext) => !!ctx.resources.get('person');

/** The roster person a set of account details names, and how; null when none (or more than one) does. */
export async function matchHolder(ctx: ModuleContext, a: Row): Promise<{ personId: string; method: string } | null> {
  if (!rosterOn(ctx)) return null;
  const one = async (sql: string, value: string, method: string) => {
    const rows = await ctx.db.query<{ id: string }>(`${sql} limit 2`, [value]);
    return rows.length === 1 ? { personId: rows[0].id, method } : null;
  };
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const employee = text(a.employee_number);
  if (employee) {
    const m = await one('select id from people where deleted_at is null and lower(employee_number) = lower($1)', employee, 'employee_number');
    if (m) return m;
  }
  const emails = [text(a.email), text(a.account_name)].filter((v): v is string => !!v && v.includes('@'));
  for (const email of emails) {
    const m = await one('select id from people where deleted_at is null and lower(email) = lower($1)', email, 'email');
    if (m) return m;
  }
  const name = text(a.display_name);
  if (name) {
    const m = await one(
      'select id from people where deleted_at is null and (lower(full_name) = lower($1) or lower(preferred_name) = lower($1))', name, 'name');
    if (m) return m;
  }
  return null;
}

/** The flag an account carries, from its own state and its holder's status on the roster. */
export async function attentionOf(ctx: ModuleContext, a: Row): Promise<Attention> {
  if ((a.status ?? 'active') !== 'active') return null;
  if ((a.account_kind ?? 'person') !== 'person') return null;
  if (!rosterOn(ctx)) return null;
  if (!a.holder_person_id) return 'unmatched';
  const p = await ctx.db.one<{ status: string | null }>('select status from people where id = $1 and deleted_at is null', [a.holder_person_id]);
  if (!p) return 'unmatched';
  const m = await personMeanings(ctx);
  if (p.status && m.left.includes(p.status)) return 'leaver';
  if (p.status && m.leave.includes(p.status)) return 'on_leave';
  return null;
}

const MATCH_FIELDS = ['email', 'employee_number', 'display_name', 'account_name'];

export function registerAccounts(ctx: ModuleContext) {
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

  async function prepare(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    for (const k of ['account_name', 'display_name', 'email', 'employee_number', 'role_on_system'] as const) {
      if (typeof patch[k] === 'string') patch[k] = patch[k].trim() || null;
    }
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (('account_name' in patch || !existing) && !merged.account_name) errors.account_name = 'Give the account name the system uses.';
    if (merged.account_name && merged.system_id && ('account_name' in patch || 'system_id' in patch)) {
      const clash = await ctx.db.one(
        `select 1 from system_accounts where system_id = $1 and lower(account_name) = lower($2) and deleted_at is null and ($3::uuid is null or id <> $3::uuid)`,
        [merged.system_id, merged.account_name, existing?.id ?? null]);
      if (clash) errors.account_name = 'This system already has an account with this name.';
    }
    if (Object.keys(errors).length) invalid(errors);

    // A holder chosen by hand (or cleared by hand) is kept; otherwise the roster is searched again
    // whenever the details that identify the holder change.
    if (req && 'holder_person_id' in patch && patch.holder_person_id !== (existing?.holder_person_id ?? null)) {
      patch.match_method = 'manual';
    } else if (merged.match_method !== 'manual' && (!existing || MATCH_FIELDS.some((f) => f in patch))) {
      const m = await matchHolder(ctx, merged);
      patch.holder_person_id = m?.personId ?? null;
      patch.match_method = m?.method ?? null;
    }
    if ('status' in patch && patch.status !== existing?.status) {
      const final = (await ctx.lookups.values('system_account_status')).filter((v) => v.meta?.final === true).map((v) => v.value);
      if (final.includes(patch.status) && !merged.removed_on) patch.removed_on = dayInZone();
      if (!final.includes(patch.status) && existing && final.includes(existing.status)) patch.removed_on = null;
    }
    patch.attention = await attentionOf(ctx, { ...merged, ...patch });
    return patch;
  }

  ctx.defineResource({
    type: 'system_account', table: 'system_accounts', module: 'systems', label: 'Account on a system', plural: 'Accounts on systems',
    path: '/api/system-accounts', route: '/access-reviews/accounts', titleField: 'account_name',
    ref: { field: 'ref', prefix: 'ACC-' },
    searchable: ['account_name', 'display_name', 'email', 'employee_number', 'role_on_system'],
    defaultSort: { field: 'account_name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      system_id: { label: 'System', type: 'ref', to: 'system', required: true },
      account_name: { label: 'Account', type: 'text', required: true, personal: true },
      display_name: { label: 'Name on the system', type: 'text', personal: true },
      email: { label: 'Email on the system', type: 'text', personal: true },
      employee_number: { label: 'Employee number on the system', type: 'text', personal: true },
      holder_person_id: { label: 'Holder', type: 'ref', to: 'person', personal: true },
      match_method: { label: 'Holder matched by', type: 'lookup', list: 'system_account_match', readOnly: true },
      account_kind: { label: 'Kind of account', type: 'lookup', list: 'system_account_kind', default: 'person' },
      role_on_system: { label: 'Role on the system', type: 'text', personal: false },
      privileged: { label: 'Privileged', type: 'boolean', default: false },
      status: { label: 'Status', type: 'lookup', list: 'system_account_status', default: 'active' },
      last_seen_on: { label: 'Last seen', type: 'date' },
      attention: { label: 'Needs attention', type: 'lookup', list: 'system_account_attention', readOnly: true },
      source: { label: 'Source', type: 'lookup', list: 'system_account_source', default: 'manual', readOnly: true },
      last_imported_at: { label: 'Last in an import', type: 'datetime', readOnly: true },
      removal_requested_on: { label: 'Removal asked for on', type: 'date', readOnly: true },
      removed_on: { label: 'Removed on', type: 'date', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => prepare(req, null, data),
      beforeUpdate: (req, existing, patch) => prepare(req, existing, patch),
    },
  });
}

/**
 * Works the holder match and flag out again for some accounts (all, by default), as system work, and
 * tells each system's owners about accounts newly flagged as a leaver's or on leave. Returns how many
 * accounts changed.
 */
export async function refreshAccounts(ctx: ModuleContext, where = 'true', params: unknown[] = []): Promise<number> {
  if (!ctx.resources.get('system_account')) return 0;
  const rows = await ctx.db.query<Row>(
    `select * from system_accounts a where a.deleted_at is null and coalesce(a.status, 'active') <> 'removed' and (${where}) order by a.created_at limit 20000`, params);
  let changed = 0;
  for (const a of rows) {
    let holder = a.holder_person_id ?? null;
    let method = a.match_method ?? null;
    if (method !== 'manual') {
      const m = await matchHolder(ctx, a);
      holder = m?.personId ?? null;
      method = m?.method ?? null;
    }
    const attention = await attentionOf(ctx, { ...a, holder_person_id: holder });
    if (holder === (a.holder_person_id ?? null) && method === (a.match_method ?? null) && attention === (a.attention ?? null)) continue;
    // Straight to the table: the hook would match again; the audit event is written here.
    await ctx.db.query('update system_accounts set holder_person_id = $2, match_method = $3, attention = $4, updated_at = now() where id = $1',
      [a.id, holder, method, attention]);
    await ctx.audit(null, {
      action: 'system_account.refresh', recordType: 'system_account', recordId: a.id,
      summary: attention ? `Flagged: ${attentionLabel(attention)}` : 'Holder or flag worked out again',
      before: { holder_person_id: a.holder_person_id, match_method: a.match_method, attention: a.attention },
      after: { holder_person_id: holder, match_method: method, attention },
    });
    changed += 1;
    if ((attention === 'leaver' || attention === 'on_leave') && attention !== a.attention) await tellOwners(ctx, a, attention);
  }
  return changed;
}

export const attentionLabel = (a: string) => (a === 'leaver' ? 'the holder has left' : a === 'on_leave' ? 'the holder is on leave' : 'the holder is not on the staff roster');

/** The system's owners hear once about each account newly flagged as a leaver's or on leave. */
async function tellOwners(ctx: ModuleContext, account: Row, attention: string) {
  if (!ctx.app.hasDecorator('notify')) return;
  const sys = await ctx.db.one<Row>('select name, business_owner_id, technical_owner_id from systems where id = $1', [account.system_id]);
  if (!sys) return;
  const to = [sys.technical_owner_id, sys.business_owner_id].filter(Boolean);
  if (!to.length) return;
  await ctx.app.notify({
    userIds: to, kind: 'access_review',
    title: `Active account on ${sys.name}: ${attentionLabel(attention)}`,
    body: 'Check whether the account should be disabled or removed, and record what was done.',
    recordType: 'system_account', recordId: account.id,
    once: `accessreviews.flag:${account.id}:${attention}:${account.holder_person_id ?? ''}`,
  });
}

// ---------------------------------------------------------------------------------------------
// Import from a file per system

/** Header names a system's account export may use, per field (compared without case, spaces or punctuation). */
const HEADERS: Record<string, string[]> = {
  account_name: ['account', 'accountname', 'username', 'user', 'login', 'loginname', 'userid', 'logonname', 'samaccountname', 'userprincipalname', 'upn'],
  display_name: ['name', 'displayname', 'fullname', 'holder', 'username(full)', 'person'],
  email: ['email', 'emailaddress', 'mail'],
  employee_number: ['employeenumber', 'employeeid', 'employeeno', 'staffnumber', 'staffid', 'payrollnumber'],
  role_on_system: ['role', 'roles', 'group', 'groups', 'profile', 'accesslevel', 'permissions', 'rolename'],
  last_seen_on: ['lastseen', 'lastlogin', 'lastlogon', 'lastsignin', 'lastactivity', 'lastused', 'lastlogindate', 'lastlogondate'],
  status: ['status', 'state', 'enabled', 'active', 'accountstatus'],
  account_kind: ['kind', 'type', 'accounttype', 'accountkind'],
  privileged: ['privileged', 'admin', 'administrator', 'isadmin'],
};
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9()]/g, '');

/** Which column holds which field: the person's mapping first, then the header names above. */
export function columnsOf(headers: string[], mapping: Record<string, string> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [field, header] of Object.entries(mapping)) {
    const i = headers.indexOf(header);
    if (i >= 0 && field in HEADERS) out[field] = i;
  }
  headers.forEach((h, i) => {
    const key = squash(h);
    for (const [field, names] of Object.entries(HEADERS)) {
      if (out[field] === undefined && names.includes(key) && !Object.values(out).includes(i)) out[field] = i;
    }
  });
  return out;
}

const YES = /^(y|yes|true|1|enabled|active|on)$/i;
const NO = /^(n|no|false|0|disabled|inactive|off|locked|suspended|expired)$/i;

export interface ImportPlanRow { line: number; account_name: string; action: 'create' | 'update' | 'unchanged'; id?: string; data: Row; error?: string }
export interface ImportResult {
  dryRun: boolean; system: { id: string; name: string }; columns: Record<string, string>; rows: number;
  created: number; updated: number; unchanged: number; missing: number; removedConfirmed: number;
  errors: { line: number; message: string }[]; warnings: string[];
}

export function registerImport(ctx: ModuleContext, onRemoved: (accountIds: string[], req: FastifyRequest) => Promise<number>) {
  ctx.app.post('/api/system-accounts/import', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const systemId = String(body.system_id ?? '');
    const system = (UUID_RE.test(systemId) ? await ctx.resources.find('system', systemId, req.user) : undefined)
      ?? ctx.fail(400, 'validation', 'Choose the system the file comes from.', { system_id: 'Choose the system the file comes from.' });
    let table;
    try { table = readUpload(body); } catch (err) {
      if (err instanceof ImportFileError) ctx.fail(400, 'bad_file', err.message);
      throw err;
    }
    const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping as Record<string, string> : {};
    const cols = columnsOf(table.headers, mapping);
    if (cols.account_name === undefined) {
      ctx.fail(400, 'bad_file', `No column holds the account name. Name one "Account", "Username" or "Login" (the file's columns: ${table.headers.slice(0, 12).join(', ')}).`);
    }
    const dryRun = body.dryRun === true || body.dry_run === true;
    const markMissing = body.markMissing !== false && body.mark_missing !== false;
    const kinds = new Set((await ctx.lookups.values('system_account_kind')).map((v) => v.value));
    const cell = (r: unknown[], f: string) => {
      const i = cols[f];
      if (i === undefined) return undefined;
      const v = r[i];
      return v === null || v === undefined ? '' : String(v).trim();
    };

    const existing = await ctx.db.query<Row>(
      'select * from system_accounts where system_id = $1 and deleted_at is null', [system.id]);
    const byName = new Map(existing.map((a) => [String(a.account_name).toLowerCase(), a]));
    const seen = new Set<string>();
    const plan: ImportPlanRow[] = [];
    const errors: { line: number; message: string }[] = [];
    table.rows.forEach((r, n) => {
      const line = table.lines[n];
      const name = cell(r, 'account_name') ?? '';
      if (!name) { errors.push({ line, message: 'No account name.' }); return; }
      const key = name.toLowerCase();
      if (seen.has(key)) { errors.push({ line, message: `Account ${name} is in the file twice; the first row was used.` }); return; }
      seen.add(key);
      const data: Row = { account_name: name };
      for (const f of ['display_name', 'email', 'employee_number', 'role_on_system'] as const) {
        const v = cell(r, f);
        if (v !== undefined) data[f] = v || null;
      }
      const seenOn = cell(r, 'last_seen_on');
      if (seenOn !== undefined) {
        const d = seenOn ? parseDate(seenOn) : null;
        if (seenOn && !d) { errors.push({ line, message: `"${seenOn}" is not a date; the last-seen date was left as it was.` }); }
        else data.last_seen_on = d;
      }
      const status = cell(r, 'status');
      if (status) data.status = NO.test(status) ? 'disabled' : YES.test(status) ? 'active' : 'active';
      const kind = cell(r, 'account_kind');
      if (kind) {
        const k = kind.toLowerCase();
        const value = kinds.has(k) ? k : /service|system|app/.test(k) ? 'service' : /shared|generic|group/.test(k) ? 'shared' : /vendor|supplier|contractor|external/.test(k) ? 'vendor' : 'person';
        if (kinds.has(value)) data.account_kind = value;
      }
      const priv = cell(r, 'privileged');
      if (priv !== undefined) data.privileged = YES.test(priv);
      const was = byName.get(key);
      if (!was) { plan.push({ line, account_name: name, action: 'create', data }); return; }
      if (was.status === 'removed' && !('status' in data)) data.status = 'active';
      const changes = Object.fromEntries(Object.entries(data).filter(([k, v]) => k !== 'account_name' && String(v ?? '') !== String(dateText(was[k]) ?? '')));
      plan.push({ line, account_name: name, action: Object.keys(changes).length ? 'update' : 'unchanged', id: was.id, data: changes });
    });
    const missing = markMissing ? existing.filter((a) => !seen.has(String(a.account_name).toLowerCase()) && a.status !== 'removed') : [];
    const result: ImportResult = {
      dryRun, system: { id: system.id, name: system.name }, rows: table.rows.length,
      columns: Object.fromEntries(Object.entries(cols).map(([f, i]) => [f, table.headers[i]])),
      created: plan.filter((p) => p.action === 'create').length, updated: plan.filter((p) => p.action === 'update').length,
      unchanged: plan.filter((p) => p.action === 'unchanged').length, missing: missing.length, removedConfirmed: 0,
      errors, warnings: table.warnings,
    };
    if (dryRun) return result;

    const now = new Date().toISOString();
    for (const p of plan) {
      try {
        if (p.action === 'create') {
          const row = await ctx.resources.create('system_account', { ...p.data, system_id: system.id }, req);
          await ctx.db.query(`update system_accounts set source = 'import', last_imported_at = $2 where id = $1`, [row.id, now]);
        } else if (p.action === 'update') {
          await ctx.resources.update('system_account', p.id!, p.data, req, { via: 'an account import' });
          await ctx.db.query('update system_accounts set last_imported_at = $2 where id = $1', [p.id, now]);
        } else {
          await ctx.db.query('update system_accounts set last_imported_at = $2 where id = $1', [p.id, now]);
        }
      } catch (err) {
        const fields = (err as { fields?: Record<string, string> }).fields;
        errors.push({ line: p.line, message: fields ? Object.values(fields).join(' ') : (err as Error).message });
        if (p.action === 'create') result.created -= 1; else if (p.action === 'update') result.updated -= 1;
      }
    }
    // Accounts the system no longer lists are gone from it: removed today.
    for (const a of missing) await ctx.resources.update('system_account', a.id, { status: 'removed' }, req, { via: 'an account import (not in the file)' });
    result.removedConfirmed = await onRemoved(missing.map((a) => a.id), req);
    await ctx.audit(req, {
      action: 'system_account.import', recordType: 'system', recordId: system.id,
      summary: `Imported accounts of ${system.name}: ${result.created} new, ${result.updated} changed, ${result.unchanged} unchanged, ${result.missing} no longer listed`,
    });
    return result;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/system-accounts/import', permission: 'systems.edit',
    summary: 'Imports the accounts of one system from its own CSV or Excel export',
    description: 'Matches rows to existing accounts by account name. Columns are found by their headers (Account or Username, Name, Email, Employee number, Role, Last login, Status, Kind, Privileged) or by `mapping` ({ field: header }). Accounts no longer in the file are marked removed unless `markMissing` is false, which also completes access-review removals waiting on them. `dryRun: true` only reports what would change.',
    body: '{ system_id, fileName?, content? (base64), text?, sheet?, mapping?, markMissing?, dryRun? }',
    response: '{ dryRun, system, columns, rows, created, updated, unchanged, missing, removedConfirmed, errors: [{ line, message }], warnings }',
  });

  ctx.app.post('/api/system-accounts/rematch', { preHandler: ctx.requirePerm('systems.edit') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const systemId = typeof body.system_id === 'string' && UUID_RE.test(body.system_id) ? body.system_id : null;
    if (systemId && !(await ctx.resources.find('system', systemId, req.user))) ctx.fail(404, 'not_found', 'System not found.');
    const changed = systemId ? await refreshAccounts(ctx, 'a.system_id = $1', [systemId]) : await refreshAccounts(ctx);
    await ctx.audit(req, { action: 'system_account.rematch', recordType: systemId ? 'system' : undefined, recordId: systemId ?? undefined, summary: `Matched account holders to the staff roster again (${changed} changed)` });
    return { changed };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/system-accounts/rematch', permission: 'systems.edit',
    summary: 'Matches account holders to the staff roster again and refreshes the flags',
    body: '{ system_id? }', response: '{ changed }',
  });
}

const dateText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
