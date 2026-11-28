// Registers an administrator defines (E41-06): the definitions, the record type each one becomes, and
// switching them into and out of the running application.
//
// A register is a record type made while the application runs. Its records live in the shared table
// `register_records` (so backups and exports carry them), read through a view of its own,
// `reg_<key>`; its fields are custom fields of that record type (core/customfields.ts); its status
// values are a list (`register_<key>_status`); its permissions are `<key>.view`, `.create`, `.edit`,
// `.delete`, `.export` (a permission module of its own, which roles grant like any other); and it is an
// area of its own (core/features.ts), switched under Administration > Features.
import type { FastifyRequest } from 'fastify';
import { defineRuntimeArea, invalidateFeatures, removeRuntimeArea } from '../../core/features.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { maySchemaChange, requestSchemaChange, schemaChangeDone } from '../../core/search.ts';
import { MODULE_KEYS } from '../admin/shared.ts';

export interface RegisterRow {
  id: string;
  key: string;
  label: string;
  plural: string;
  description: string;
  prefix: string;
  nav_group: string;
  icon: string;
  title_label: string;
  evidence: boolean;
  created_at: string;
  updated_at: string;
}

/** Menu groups a register may sit in (web/src/core/module.ts NAV_GROUPS, without Home and Administration). */
export const NAV_GROUPS = [
  'IT services', 'Assets', 'Vendors', 'Projects and funding', 'Security', 'Risk and compliance',
  'Safety and emergency management', 'Governance and records', 'Documents', 'People and training', 'Reports',
];
/** The group a new register goes in when none is given. */
export const DEFAULT_NAV_GROUP = 'Governance and records';
/**
 * Menu groups before wave 24 (E44-01) and the group that took their place. Stored registers may still
 * name an old group; it is read as the new one, and sending an old name is accepted and stored as the new one.
 */
export const LEGACY_NAV_GROUPS: Record<string, string> = {
  'Service desk': 'IT services', Change: 'IT services', Inventory: 'Assets', Cybersecurity: 'Security',
  Safety: 'Safety and emergency management', Governance: 'Governance and records', People: 'People and training',
  Projects: 'Projects and funding', Help: 'Governance and records',
};
/** A stored or sent menu group as today's name (an unknown one is returned unchanged, for the caller to refuse). */
export const currentNavGroup = (group: string): string => LEGACY_NAV_GROUPS[group] ?? group;
/** Icons a register may use in the menu (web/src/core/Icon.tsx). */
export const ICONS = ['folder', 'clipboard', 'book', 'box', 'tag', 'alert', 'shield', 'bus', 'building', 'key', 'calendar', 'users', 'star', 'flask'];

export const KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,7}-$/;
/** Permission modules, menu words and addresses a register's key may not take. */
const BUILT_IN_MODULES = new Set(MODULE_KEYS);
const RESERVED = new Set(['new', 'admin', 'api', 'me', 'mine', 'all', 'stats', 'registers', 'register', 'mcp', 'scim', 'core', 'search', 'help', 'home', 'account', 'settings', 'templates']);

export const typeOf = (key: string) => `reg_${key}`;
export const statusList = (key: string) => `register_${key}_status`;
/** The register's own area (Administration > Features). */
export const areaOf = (key: string) => `reg_${key}`;

/** Whether a key is free to be a register's key (format checked separately). */
export function keyTaken(ctx: ModuleContext, key: string): string | null {
  if (RESERVED.has(key) || BUILT_IN_MODULES.has(key)) return 'That name is used by the application. Choose another.';
  if (ctx.resources.all().some((d) => d.module === key)) return 'That name is used by the application. Choose another.';
  return null;
}

/** The record type of one register. */
export function toDef(r: RegisterRow, prepare?: NonNullable<ResourceDef['hooks']>['prepare']): ResourceDef {
  const key = r.key;
  return {
    type: typeOf(key), table: typeOf(key), module: key, label: r.label, plural: r.plural,
    path: `/api/registers/${key}`, route: `/registers/${key}`, titleField: 'title',
    ref: { field: 'ref', prefix: r.prefix },
    partition: { column: 'register_key', value: key },
    searchable: ['title', 'description'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    evidence: r.evidence,
    // Roles may be scoped to their departments or sites (E41-01), as for built-in types.
    scope: { department: 'department_id', site: 'site_id' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: r.title_label || 'Title', type: 'text', required: true },
      status: { label: 'Status', type: 'lookup', list: statusList(key) },
      owner_id: { label: 'Owner', type: 'user' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      description: { label: 'Description', type: 'longtext' },
    },
    hooks: prepare ? { prepare } : undefined,
  };
}

const DEFAULT_STATUSES = [
  { value: 'open', label: 'Open', color: 'blue', sort: 10 },
  { value: 'in_progress', label: 'In progress', color: 'amber', sort: 20 },
  { value: 'closed', label: 'Closed', color: 'green', sort: 30 },
];

export type RegisterState = 'ready' | 'waiting' | 'clash';

/**
 * The registers of this application instance: their definitions, which are in the running
 * application, and which wait for the database owner (a least-privilege run-time account cannot
 * create the register's view; `migrate` as the owner does it, E16-37).
 */
export function makeRegisters(ctx: ModuleContext) {
  const { db } = ctx;
  const rows = new Map<string, RegisterRow>();
  const state = new Map<string, RegisterState>();
  const active = new Map<string, ResourceDef>();
  let signature = '';
  let ready = false;

  /** A new record without a status takes the list's first value still in use. */
  const prepare = (key: string) => async (_req: FastifyRequest | null, input: Row, existing: Row | null) => {
    if (existing || (input.status !== undefined && input.status !== null && input.status !== '')) return input;
    const first = (await ctx.lookups.values(statusList(key))).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0];
    return first ? { ...input, status: first.value } : input;
  };

  /** Whether this connection may create, replace and drop the registers' views and search triggers. */
  const mayChangeSchema = () => maySchemaChange(db, 'register_records');

  /** Whether the register's view exists with every column of the shared table. */
  async function viewCurrent(key: string): Promise<boolean> {
    const r = await db.one<{ v: number; b: number; kind: string | null }>(
      `select (select count(*)::int from information_schema.columns where table_schema = current_schema() and table_name = $1) as v,
              (select count(*)::int from information_schema.columns where table_schema = current_schema() and table_name = 'register_records') as b,
              (select c.relkind::text from pg_class c where c.oid = to_regclass($1)) as kind`, [typeOf(key)]);
    return Boolean(r && r.kind === 'v' && r.v === r.b);
  }

  async function createView(key: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new Error(`Bad register key ${key}`);
    const view = typeOf(key);
    await db.exec(`
      create or replace view ${view} as select * from register_records where register_key = '${key}' with local check option;
      alter view ${view} alter column register_key set default '${key}';`);
  }

  async function dropSchema(key: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new Error(`Bad register key ${key}`);
    const type = typeOf(key);
    await db.exec(`
      drop trigger if exists ${type}_search on register_records;
      drop function if exists ${type}_search_tg();
      drop view if exists ${type};`);
    await db.query('delete from search_index where record_type = $1', [type]);
    await db.query('delete from search_index_state where table_name = $1', [type]);
  }

  /** Puts one register into the running application (its view made first when needed). */
  async function activate(r: RegisterRow, afterStart: boolean): Promise<RegisterState> {
    rows.set(r.key, { ...r, nav_group: currentNavGroup(r.nav_group) });
    const type = typeOf(r.key);
    const existing = active.get(r.key);
    if (existing) {
      refresh(existing, r);
      state.set(r.key, 'ready');
      return 'ready';
    }
    if (keyTaken(ctx, r.key) || ctx.app.runtimeResources.handlers(type)) {
      console.warn(`[registers] ${r.key}: the name is now used by the application; the register is left out. Rename it in the database or remove the other use.`);
      state.set(r.key, 'clash');
      return 'clash';
    }
    if (!(await viewCurrent(r.key))) {
      if (!(await mayChangeSchema())) {
        await requestSchemaChange(db, 'register', r.key, `The register "${r.plural}" needs its database view: run migrate as the owner.`);
        state.set(r.key, 'waiting');
        return 'waiting';
      }
      await createView(r.key);
    }
    await schemaChangeDone(db, 'register', r.key);
    await ctx.lookups.ensure(statusList(r.key), DEFAULT_STATUSES, { module: r.key });
    const def = toDef(r, prepare(r.key));
    ctx.app.runtimeResources.define(def);
    active.set(r.key, def);
    if (!MODULE_KEYS.includes(r.key)) MODULE_KEYS.push(r.key);
    defineArea(r);
    if (afterStart) await ctx.app.runtimeResources.refreshSearch(def);
    state.set(r.key, 'ready');
    return 'ready';
  }

  function defineArea(r: RegisterRow) {
    defineRuntimeArea({
      key: areaOf(r.key), label: r.plural, defaultOn: true,
      description: r.description.trim() || `The ${r.plural.toLowerCase()} register, defined under Administration > Registers.`,
      permissions: [r.key], types: [typeOf(r.key)], modules: [], jobs: [],
    });
    invalidateFeatures(db);
  }

  /** A changed definition: the same record type object is updated (other modules hold it). */
  function refresh(def: ResourceDef, r: RegisterRow) {
    const fresh = toDef(r);
    def.label = fresh.label;
    def.plural = fresh.plural;
    def.ref = fresh.ref;
    def.evidence = fresh.evidence;
    def.fields = { ...def.fields, title: fresh.fields.title };
    defineArea(r);
  }

  /** Takes a register out of the running application. */
  function deactivate(key: string) {
    const type = typeOf(key);
    if (active.has(key)) ctx.app.runtimeResources.remove(type);
    active.delete(key);
    rows.delete(key);
    state.delete(key);
    const i = MODULE_KEYS.indexOf(key);
    if (i >= 0 && !BUILT_IN_MODULES.has(key)) MODULE_KEYS.splice(i, 1);
    removeRuntimeArea(areaOf(key));
    invalidateFeatures(db);
  }

  const sigOf = (list: Pick<RegisterRow, 'key' | 'updated_at'>[]) =>
    list.map((r) => `${r.key}@${new Date(r.updated_at).toISOString()}`).sort().join('|');

  /** Reads every definition and brings the running application in line (start-up, and other server processes' changes). */
  async function load(afterStart: boolean): Promise<void> {
    const list = await db.query<RegisterRow>('select * from register_definitions order by key');
    signature = sigOf(list);
    const keys = new Set(list.map((r) => r.key));
    for (const key of [...rows.keys()]) if (!keys.has(key)) deactivate(key);
    for (const r of list) {
      try {
        await activate(r, afterStart);
      } catch (err) {
        console.error(`[registers] ${r.key} could not be loaded:`, err);
      }
    }
  }

  let checkedAt = 0;
  let checking: Promise<void> | null = null;
  /** At most every five seconds: picks up definitions another server process changed. */
  async function sync(): Promise<void> {
    if (!ready || Date.now() - checkedAt < 5_000) return;
    checkedAt = Date.now();
    checking ??= (async () => {
      try {
        const now = await db.query<{ key: string; updated_at: string }>('select key, updated_at from register_definitions');
        if (sigOf(now) !== signature) await load(true);
      } catch (err) {
        console.error('[registers] could not check for changed registers:', err);
      } finally {
        checking = null;
      }
    })();
    await checking;
  }

  return {
    rows, state, active,
    load, sync, activate, deactivate, dropSchema, mayChangeSchema,
    markReady() { ready = true; },
    /** Notes the signature after a change made in this process, so `sync` does not reload for it. */
    async noteChange() {
      signature = sigOf(await db.query<RegisterRow>('select key, updated_at from register_definitions'));
    },
  };
}

export type Registers = ReturnType<typeof makeRegisters>;
