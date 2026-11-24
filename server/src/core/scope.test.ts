// E41-01: role grants scoped to a person's departments or sites. Every record type that carries a
// department or a site is checked the same way: a person whose role is scoped sees the records of
// their own departments or sites (and those below them) and the ones they created, in lists, record
// pages, pickers, search and exports, and not the others; figures stay the same for everyone.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ResourceDef } from './module.ts';
import { scopeKinds, type ScopeKind } from './scope.ts';
import { testApp } from '../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
const ids: Record<string, string> = {};
let roleCount = 0;

beforeAll(async () => {
  t = await testApp();
  const dept = async (name: string, parent: string | null = null) =>
    (await t.db.one<{ id: string }>('insert into departments (name, parent_id) values ($1, $2) returning id', [name, parent]))!.id;
  ids.deptA = await dept('Invented depot operations');
  ids.deptA1 = await dept('Invented night shift', ids.deptA);
  ids.deptB = await dept('Invented head office');
  if (t.ctx.resources.get('site')) {
    const site = async (name: string, parent: string | null = null) =>
      (await t.db.one<{ id: string }>('insert into sites (name, parent_id) values ($1, $2) returning id', [name, parent]))!.id;
    ids.siteS = await site('Invented north depot');
    ids.siteS1 = await site('Invented north depot wash bay', ids.siteS);
    ids.siteT = await site('Invented south depot');
  }
}, 120_000);
afterAll(async () => { await t?.close(); });

/** A value for a NOT NULL column with no default, by its database type. */
function filler(dataType: string): string {
  if (/uuid/.test(dataType)) return 'gen_random_uuid()';
  if (/int|numeric|double|real/.test(dataType)) return '0';
  if (/timestamp/.test(dataType)) return 'now()';
  if (dataType === 'date') return 'current_date';
  if (dataType === 'boolean') return 'false';
  if (/json/.test(dataType)) return `'{}'`;
  return `'x-' || gen_random_uuid()`;
}

/** Inserts a bare row of a type (only the columns the table needs), with the given values. */
async function bareRow(def: ResourceDef, values: Record<string, string | null>, createdBy: string | null = null): Promise<string> {
  const cols = await t.db.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
     where table_schema = current_schema() and table_name = $1 and is_nullable = 'NO' and column_default is null`, [def.table]);
  const names: string[] = [];
  const exprs: string[] = [];
  const params: unknown[] = [];
  for (const c of cols) {
    if (c.column_name in values) continue;
    names.push(c.column_name);
    exprs.push(filler(c.data_type));
  }
  for (const [k, v] of Object.entries({ ...values, created_by: createdBy })) {
    names.push(k);
    params.push(v);
    exprs.push(`$${params.length}`);
  }
  const row = await t.db.one<{ id: string }>(`insert into ${def.table} (${names.join(', ')}) values (${exprs.join(', ')}) returning id`, params);
  return row!.id;
}

/** The columns a scope kind is written to for a type, with the place's id. */
async function placeValues(def: ResourceDef, kind: ScopeKind, place: string): Promise<Record<string, string>> {
  const s = def.scope![kind]!;
  if (typeof s === 'string') return { [s]: place };
  // A records destruction belongs where its record series does.
  if (def.type === 'records_destruction') {
    const series = t.core.resources.registry.get('record_series')!;
    return { series_id: await bareRow(series, { [series.scope![kind] as string]: place, [series.titleField]: 'Zseries' }) };
  }
  // Inspections, inspection schedules and condition assessments of a site: a target of type "site".
  return { target_type: 'site', target_id: place };
}

/** A role holding view and export of the type's module, scoped to `kind`, and a person in it. */
async function scopedPerson(def: ResourceDef, kind: ScopeKind) {
  const key = `scoped_${def.type}_${kind}_${++roleCount}`;
  const role = await t.db.one<{ id: string }>(
    `insert into roles (key, name, description, enabled, scopes) values ($1, $1, '', true, $2) returning id`,
    [key, JSON.stringify({ [def.module]: kind })]);
  // Viewing sites and vehicles is needed by some types' own rules (a site's condition assessment).
  for (const g of new Set([`${def.module}.view`, `${def.module}.export`, 'sites.view', 'fleet.view', 'assets.view'])) {
    await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, g]);
  }
  const who = await t.as(key);
  if (kind === 'department') await t.db.query('update users set department_id = $1 where id = $2', [ids.deptA, who.userId]);
  else await t.db.query('update sites set manager_id = $1 where id = $2', [who.userId, ids.siteS]);
  return who;
}

describe('every record type that carries a department or a site', () => {
  it('is scoped: lists, record pages, pickers, exports and search show only the person\'s own places; figures are the same', async () => {
    const scoped = t.ctx.resources.all().filter((d) => scopeKinds(d).length);
    // The types E41-01 scopes, when their modules are loaded.
    for (const type of ['person', 'position', 'asset', 'site', 'action', 'hazard', 'safety_event', 'inspection', 'vehicle', 'project', 'business_process']) {
      if (t.ctx.resources.get(type)) expect(scoped.map((d) => d.type)).toContain(type);
    }
    let checked = 0;
    for (const def of scoped) {
      for (const kind of scopeKinds(def)) {
        if (kind === 'site' && !ids.siteS) continue;
        const who = await scopedPerson(def, kind);
        const [inPlace, outPlace] = kind === 'department' ? [ids.deptA1, ids.deptB] : [ids.siteS1, ids.siteT];
        const title = def.fields[def.titleField]?.type === 'text' || def.titleField === 'name';
        const named = (label: string) => (title ? { [def.titleField]: `${label} ${def.type} ${kind}` } : {});
        // The site type is its own place: its rows are the sites themselves.
        const selfPlace = def.scope![kind] === 'id';
        const inside = selfPlace ? inPlace : await bareRow(def, { ...(await placeValues(def, kind, inPlace)), ...named('Zinside') });
        const outside = selfPlace ? outPlace : await bareRow(def, { ...(await placeValues(def, kind, outPlace)), ...named('Zoutside') });
        const mine = selfPlace ? null : await bareRow(def, { ...(await placeValues(def, kind, outPlace)), ...named('Zmine') }, who.userId);
        const what = `${def.type} (${kind})`;

        const list = await who.get(`${def.path}?pageSize=500`);
        expect(list.status, what).toBe(200);
        const listed = list.body.rows.map((r: any) => r.id);
        expect(listed, what).toContain(inside);
        expect(listed, what).not.toContain(outside);
        if (mine) expect(listed, `${what}: created by them`).toContain(mine);
        expect((await who.get(`${def.path}/${inside}`)).status, what).toBe(200);
        expect((await who.get(`${def.path}/${outside}`)).status, what).toBe(404);
        // Everyone sees everything with an unscoped grant (the administrator here).
        expect((await t.api.get(`${def.path}/${outside}`)).status, what).toBe(200);

        // Figures count every record, for everyone.
        const theirs = await who.get(`${def.path}/stats?group=created_by`);
        const admins = await t.api.get(`${def.path}/stats?group=created_by`);
        expect(theirs.body.total, `${what}: figures`).toBe(admins.body.total);

        // Pickers and labels.
        const picked = (await who.get(`/api/records/lookup?type=${def.type}&q=`)).body.map((r: any) => r.id);
        expect(picked, `${what}: picker`).not.toContain(outside);
        const labels = (await who.post('/api/records/labels', { records: { [def.type]: [inside, outside] } })).body[def.type];
        expect(Object.keys(labels), `${what}: labels`).toEqual([inside]);

        // Exports.
        const csv = await who.get(`${def.path}?format=csv&pageSize=500`);
        expect(csv.status, `${what}: export`).toBe(200);
        if (title && !selfPlace) {
          expect(csv.text, `${what}: export`).toContain(`Zinside ${def.type} ${kind}`);
          expect(csv.text, `${what}: export`).not.toContain(`Zoutside ${def.type} ${kind}`);
          // Search (by title).
          await t.core.resources.refreshSearch(def);
          const found = (await who.get(`/api/search?q=${encodeURIComponent(`Zoutside ${def.type}`)}`)).body as any[];
          expect(found.filter((r) => r.type === def.type).map((r) => r.id), `${what}: search`).not.toContain(outside);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  }, 300_000);
});

describe('how scoped grants combine', () => {
  it('an unscoped role lifts the scope, a scope for a kind the type does not carry leaves it alone, and departments below count', async () => {
    if (!t.ctx.resources.get('action')) return;
    const def = t.ctx.resources.get('action')!;
    const who = await scopedPerson(def, 'department');
    const below = await bareRow(def, { department_id: ids.deptA1, title: 'Below action' });
    const other = await bareRow(def, { department_id: ids.deptB, title: 'Other action' });
    const none = await bareRow(def, { department_id: null, title: 'No department action' });
    const seen = async () => (await who.get('/api/actions?pageSize=500')).body.rows.map((r: any) => r.id);
    expect(await seen()).toEqual(expect.arrayContaining([below]));
    expect(await seen()).not.toContain(other);
    expect(await seen()).not.toContain(none);

    // The department's manager is scoped to it too (and those below it).
    await t.db.query('update users set department_id = null where id = $1', [who.userId]);
    expect(await seen()).not.toContain(below);
    await t.db.query('update departments set manager_id = $1 where id = $2', [who.userId, ids.deptA]);
    expect(await seen()).toContain(below);

    // A second role granting the same module without a scope lifts it.
    const open = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('open_actions', 'Open actions', '', true) returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'actions.view')`, [open!.id]);
    await t.db.query('insert into user_roles (user_id, role_id) values ($1, $2)', [who.userId, open!.id]);
    expect(await seen()).toContain(other);
    await t.db.query('delete from user_roles where user_id = $1 and role_id = $2', [who.userId, open!.id]);
    expect(await seen()).not.toContain(other);

    // Scoped to sites only: projects (which carry no site) are not narrowed.
    if (t.ctx.resources.get('project')) {
      const sitesOnly = await t.db.one<{ id: string }>(
        `insert into roles (key, name, description, enabled, scopes) values ('site_projects', 'Site projects', '', true, '{"projects":"site"}') returning id`);
      await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'projects.view')`, [sitesOnly!.id]);
      const pm = await t.as('site_projects');
      const p = await bareRow(t.ctx.resources.get('project')!, { department_id: ids.deptB, name: 'Unscoped project' });
      expect((await pm.get(`/api/projects/${p}`)).status).toBe(200);
    }
  });

  it('a new action takes its source record\'s site', async () => {
    if (!t.ctx.resources.get('hazard') || !t.ctx.resources.get('action')) return;
    const hazard = await bareRow(t.ctx.resources.get('hazard')!, { site_id: ids.siteS1, title: 'Invented loose grating' });
    const action = await t.ctx.resources.create('action', { title: 'Fix the grating', source_type: 'hazard', source_id: hazard });
    expect(action.site_id).toBe(ids.siteS1);
  });
});

describe('scopes in the role editor', () => {
  it('offers the modules that can be scoped, saves and audits a scope, and refuses one that does not apply', async () => {
    const roles = (await t.api.get('/api/admin/roles')).body;
    expect(roles.scopable.safety ?? roles.scopable.actions).toBeTruthy();
    const made = await t.api.post('/api/admin/roles', { name: 'Invented depot manager', grants: ['actions.view', 'actions.edit'], scopes: { actions: 'site' } });
    expect(made.status).toBe(201);
    expect(made.body.scopes).toEqual({ actions: 'site' });
    const changed = await t.api.patch(`/api/admin/roles/${made.body.id}`, { scopes: { actions: 'department' } });
    expect(changed.body.scopes).toEqual({ actions: 'department' });
    const audit = (await t.api.get(`/api/audit?record_type=role&record_id=${made.body.id}`)).body;
    expect(JSON.stringify(audit)).toContain('scopes');
    // Clearing: "all" or nothing.
    expect((await t.api.patch(`/api/admin/roles/${made.body.id}`, { scopes: { actions: 'all' } })).body.scopes).toEqual({});
    // Not offered: a module with no type that carries a place, or a made-up kind.
    expect((await t.api.patch(`/api/admin/roles/${made.body.id}`, { scopes: { policies: 'site' } })).body.error.fields.scopes).toBeTruthy();
    expect((await t.api.patch(`/api/admin/roles/${made.body.id}`, { scopes: { actions: 'region' } })).body.error.fields.scopes).toBeTruthy();
    const admin = (await t.api.get('/api/admin/roles')).body.roles.find((r: any) => r.key === 'administrator');
    expect((await t.api.patch(`/api/admin/roles/${admin.id}`, { scopes: { actions: 'site' } })).body.error.fields.scopes).toMatch(/every record/);
  });
});

describe('converting the department kept as text', () => {
  it('adds names that are not in the list and points each record at its department', async () => {
    if (!t.ctx.resources.get('asset')) return;
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    // A record written by an earlier version: text only (the database trigger finds no such department).
    const old = (await t.db.one<{ id: string }>(`insert into assets (name, department) values ('Legacy invented plotter', 'Invented legacy drafting') returning id`))!.id;
    expect((await t.db.one<{ department_id: string | null }>('select department_id from assets where id = $1', [old]))!.department_id).toBeNull();
    // The upgrade's conversion (inventory migration 009) runs again safely.
    await t.db.exec(readFileSync(fileURLToPath(new URL('../modules/inventory/migrations/009_access_scope.sql', import.meta.url)), 'utf8'));
    const row = await t.db.one<{ department_id: string; department: string }>('select department_id, department from assets where id = $1', [old]);
    const dept = await t.db.one<{ name: string }>('select name from departments where id = $1 and deleted_at is null', [row!.department_id]);
    expect(dept!.name).toBe('Invented legacy drafting');
    // Written by name afterwards (an older client): the trigger matches it to the department.
    const later = (await t.db.one<{ department_id: string }>(`insert into assets (name, department) values ('Legacy invented scanner', 'invented LEGACY drafting') returning department_id`))!;
    expect(later.department_id).toBe(row!.department_id);
  });
});

describe('departments', () => {
  it('are records with a parent and a manager, any signed-in person can pick them, and one can be merged into another', async () => {
    const top = await t.api.post('/api/departments', { name: 'Invented maintenance' });
    expect(top.status).toBe(201);
    const child = await t.api.post('/api/departments', { name: 'Invented bus maintenance', parent_id: top.body.id });
    expect(child.body.parent_id).toBe(top.body.id);
    // No loops, no second department of the same name.
    expect((await t.api.patch(`/api/departments/${top.body.id}`, { parent_id: child.body.id })).body.error.fields.parent_id).toBeTruthy();
    expect((await t.api.post('/api/departments', { name: 'invented MAINTENANCE' })).body.error.fields.name).toBeTruthy();

    // A person without people.view picks and reads departments (a directory), but not the department pages.
    const requester = await t.as('requester');
    expect((await requester.get('/api/records/lookup?type=department&q=Invented bus')).body.map((d: any) => d.id)).toContain(child.body.id);
    expect((await requester.get('/api/departments')).status).toBe(403);

    // Merging moves what points at it (here an account and the department below it).
    const dupe = await t.api.post('/api/departments', { name: 'Invented fleet maintenance' });
    const grandchild = await t.api.post('/api/departments', { name: 'Invented tyre shop', parent_id: dupe.body.id });
    await t.db.query('update users set department_id = $1 where id = $2', [dupe.body.id, requester.userId]);
    const merged = await t.api.post(`/api/departments/${dupe.body.id}/merge`, { into: top.body.id });
    expect(merged.status).toBe(200);
    expect(merged.body.moved.users).toBe(1);
    expect((await t.db.one<{ department_id: string }>('select department_id from users where id = $1', [requester.userId]))!.department_id).toBe(top.body.id);
    expect((await t.api.get(`/api/departments/${grandchild.body.id}`)).body.parent_id).toBe(top.body.id);
    expect((await t.api.get(`/api/departments/${dupe.body.id}`)).status).toBe(404);
    // A removed department's name can be used again.
    expect((await t.api.post('/api/departments', { name: 'Invented fleet maintenance' })).status).toBe(201);
  });
});

describe('a scoped person cannot widen their own scope (wave 23 A1)', () => {
  it('refuses moving a department\'s or site\'s manager or parent, linking a roster row to themselves, and merging', async () => {
    if (!t.ctx.resources.get('person') || !t.ctx.resources.get('action')) return;
    // Actions scoped to their departments; the roster, departments and sites unscoped and editable.
    const role = await t.db.one<{ id: string }>(
      `insert into roles (key, name, description, enabled, scopes) values ('widen_test', 'Widen test', '', true, '{"actions":"department"}') returning id`);
    for (const g of ['actions.view', 'people.view', 'people.create', 'people.edit', 'people.delete', 'sites.view', 'sites.edit']) {
      await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, g]);
    }
    const who = await t.as('widen_test');
    await t.db.query('update users set department_id = $1 where id = $2', [ids.deptA, who.userId]);
    const action = await bareRow(t.ctx.resources.get('action')!, { department_id: ids.deptB, title: 'Invented head office action' });
    const sees = async () => (await who.get(`/api/actions/${action}`)).status;
    expect(await sees()).toBe(404);

    // 1. Making themselves the manager of another department, or moving it under their own.
    const manager = await who.patch(`/api/departments/${ids.deptB}`, { manager_id: who.userId });
    expect(manager.status).toBe(400);
    expect(manager.body.error.fields.manager_id).toMatch(/administrator/);
    expect((await who.patch(`/api/departments/${ids.deptB}`, { parent_id: ids.deptA })).body.error.fields.parent_id).toBeTruthy();
    // Other changes to a department are still theirs to make, and sending the same values back is fine.
    expect((await who.patch(`/api/departments/${ids.deptB}`, { description: 'Invented description', manager_id: null, parent_id: null })).status).toBe(200);
    // Merging moves records and departments between scopes too.
    expect((await who.post(`/api/departments/${ids.deptB}/merge`, { into: ids.deptA })).status).toBe(403);

    // 2. A roster row linked to their own account, in another department.
    const linked = await who.post('/api/people', { full_name: 'Invented Self', user_id: who.userId, department_id: ids.deptB });
    expect(linked.status).toBe(400);
    expect(linked.body.error.fields.user_id).toBeTruthy();
    // A row already theirs cannot be moved to another department either; someone else's row can.
    const mine = await t.api.post('/api/people', { full_name: 'Invented Own Row', user_id: who.userId, department_id: ids.deptA });
    expect(mine.status).toBe(201);
    expect((await who.patch(`/api/people/${mine.body.id}`, { department_id: ids.deptB })).body.error.fields.department_id).toBeTruthy();
    const other = await t.api.post('/api/people', { full_name: 'Invented Colleague', department_id: ids.deptA });
    expect((await who.patch(`/api/people/${other.body.id}`, { department_id: ids.deptB })).status).toBe(200);
    expect((await who.patch(`/api/people/${other.body.id}`, { user_id: who.userId })).body.error.fields.user_id).toBeTruthy();

    // 3. A site's manager.
    if (ids.siteT) expect((await who.patch(`/api/sites/${ids.siteT}`, { manager_id: who.userId })).body.error.fields.manager_id).toBeTruthy();

    expect(await sees()).toBe(404);

    // An administrator may; so may someone none of whose roles is scoped.
    expect((await t.api.patch(`/api/departments/${ids.deptB}`, { manager_id: who.userId })).status).toBe(200);
    expect(await sees()).toBe(200);
    expect((await t.api.patch(`/api/departments/${ids.deptB}`, { manager_id: null })).status).toBe(200);
    const open = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('widen_open', 'Widen open', '', true) returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'people.edit'), ($1, 'people.view')`, [open!.id]);
    const hr = await t.as('widen_open');
    expect((await hr.patch(`/api/departments/${ids.deptB}`, { parent_id: ids.deptA })).status).toBe(200);
    expect((await hr.patch(`/api/departments/${ids.deptB}`, { parent_id: null })).status).toBe(200);
  });
});

describe('figures grouped by a detail (wave 23 A2)', () => {
  it('put records outside the person\'s scope under "Other records"; the total and the list-field figures stay the same', async () => {
    if (!t.ctx.resources.get('person')) return;
    const def = t.ctx.resources.get('person')!;
    const who = await scopedPerson(def, 'department');
    await bareRow(def, { department_id: ids.deptA1, full_name: 'Invented Inside Person', notes: 'Znote inside', status: 'active' });
    await bareRow(def, { department_id: ids.deptB, full_name: 'Invented Outside Person', notes: 'Znote outside', status: 'active' });
    const theirs = await who.get('/api/people/stats?group=notes');
    const admins = await t.api.get('/api/people/stats?group=notes');
    expect(theirs.status).toBe(200);
    const labels = theirs.body.groups.map((g: any) => g.label);
    expect(labels).toContain('Znote inside');
    expect(labels).not.toContain('Znote outside');
    expect(labels).toContain('Other records');
    expect(admins.body.groups.map((g: any) => g.label)).toContain('Znote outside');
    expect(theirs.body.total).toBe(admins.body.total);
    // Grouping by a list field gives everyone the same figures.
    const byStatus = async (api: typeof who | typeof t.api) => (await api.get('/api/people/stats?group=status')).body;
    expect(await byStatus(who)).toEqual(await byStatus(t.api));
    // Nor can a figure be matched by an out-of-scope record's words.
    expect((await who.get(`/api/people/stats?group=status&f.notes=${encodeURIComponent('Znote outside')}`)).body.total).toBe(0);
    expect((await t.api.get(`/api/people/stats?group=status&f.notes=${encodeURIComponent('Znote outside')}`)).body.total).toBe(1);
  });
});
