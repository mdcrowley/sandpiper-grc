import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { AREAS } from '../../core/features.ts';

// E41-06: a register an administrator defines behaves like a built-in record type: lists, record
// pages, search, history, attachments, imports, exports, lifecycles, reports, permissions of its own,
// and a switch of its own under Administration > Features.

let t: Awaited<ReturnType<typeof testApp>>;
const CSV = (text: string) => ({ fileName: 'keys.csv', content: Buffer.from(text).toString('base64') });

beforeAll(async () => { t = await testApp(); }, 120_000);
afterAll(async () => { await t?.close(); });

const define = (body: Record<string, unknown>) => t.api.post('/api/admin/registers', body);

describe('defining a register', () => {
  it('checks the definition', async () => {
    const bad = await define({ label: '', plural: 'Keys', prefix: 'k k', key: 'Tickets!' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['key', 'label', 'prefix']);
    // Names the application uses, and prefixes another record type numbers with, are refused.
    expect((await define({ label: 'Thing', plural: 'Things', prefix: 'TH', key: 'tickets' })).body.error.fields.key).toMatch(/used by the application/);
    expect((await define({ label: 'Thing', plural: 'Things', prefix: 'TKT' })).body.error.fields.prefix).toMatch(/Another kind/);
  });

  it('makes a record type with its numbering, permissions, status list, menu place and switch', async () => {
    const res = await define({
      label: 'Key issued', plural: 'Key log', key: 'key_log', prefix: 'key', nav_group: 'Inventory', icon: 'key', title_label: 'Key',
      description: 'Keys and access cards issued to staff and contractors.',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ key: 'key_log', type: 'reg_key_log', prefix: 'KEY-', state: 'ready', area: 'reg_key_log', route: '/registers/key_log' });
    expect(res.body.permissions).toEqual(['key_log.view', 'key_log.create', 'key_log.edit', 'key_log.delete', 'key_log.export']);

    const meta = (await t.api.get('/api/meta')).body;
    expect(meta.resources.reg_key_log).toMatchObject({ label: 'Key issued', plural: 'Key log', module: 'key_log', path: '/api/registers/key_log', route: '/registers/key_log', refField: 'ref' });
    expect(meta.resources.reg_key_log.fields.title.label).toBe('Key');
    expect(meta.lookups.register_key_log_status.map((v: any) => v.value)).toEqual(['open', 'in_progress', 'closed']);

    const features = (await t.api.get('/api/admin/features')).body.areas;
    expect(features.find((a: any) => a.key === 'reg_key_log')).toMatchObject({ label: 'Key log', on: true });
    expect((await t.api.get('/api/registers')).body).toEqual([expect.objectContaining({ key: 'key_log', navGroup: 'Inventory', icon: 'key', canCreate: true })]);
    // The role editor offers its permission module.
    expect((await t.api.get('/api/admin/roles')).body.modules).toContain('key_log');
    expect((await define({ label: 'Again', plural: 'Again', key: 'key_log', prefix: 'AG' })).body.error.fields.key).toMatch(/already/);
  });

  it('takes fields as custom fields, and changes keep the same record type', async () => {
    const f = await t.api.post('/api/admin/custom-fields', {
      record_type: 'reg_key_log', label: 'Kind', key: 'kind', type: 'select', options: ['Key', 'Access card'],
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'reg_key_log', label: 'Issued on', key: 'issued_on', type: 'date' })).status).toBe(201);
    const changed = await t.api.patch('/api/admin/registers/key_log', { plural: 'Keys and cards', title_label: 'Key or card' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.fields.map((x: any) => x.key).sort()).toEqual(['issued_on', 'kind']);
    const meta = (await t.api.get('/api/meta')).body.resources.reg_key_log;
    expect([meta.plural, meta.fields.title.label, meta.fields.cf_kind.list]).toEqual(['Keys and cards', 'Key or card', 'cf_reg_key_log_kind']);
    expect((await t.api.patch('/api/admin/registers/key_log', { key: 'other' })).status).toBe(400);
  });
});

describe('records of a register', () => {
  let id = '';

  it('creates, numbers, lists, filters, counts and changes records like any record type', async () => {
    const made = await t.api.post('/api/registers/key_log', { title: 'Depot gate key 14', cf_kind: 'key', cf_issued_on: '2026-03-02', description: 'Issued for the night shift.' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ ref: 'KEY-00001', status: 'open', cf_kind: 'key', register_key: 'key_log' });
    id = made.body.id;
    expect((await t.api.post('/api/registers/key_log', { title: 'Access card 7', cf_kind: 'card' })).body.error.fields.cf_kind).toMatch(/not an allowed value/);
    await t.api.post('/api/registers/key_log', { title: 'Access card 7', cf_kind: 'access_card', status: 'closed' });

    const list = await t.api.get('/api/registers/key_log?f.cf_kind=key');
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0]._display.cf_kind).toBe('Key');
    expect((await t.api.get('/api/registers/key_log?q=gate')).body.rows.map((r: any) => r.ref)).toEqual(['KEY-00001']);
    const stats = (await t.api.get('/api/registers/key_log/stats?group=status')).body;
    expect(stats.total).toBe(2);

    const one = await t.api.get(`/api/registers/key_log/${id}`);
    expect(one.body.title).toBe('Depot gate key 14');
    const etag = (await t.app.inject({ method: 'GET', url: `/api/registers/key_log/${id}`, headers: { cookie: (await cookie()) } })).headers.etag;
    expect(etag).toBeTruthy();
    expect((await t.api.patch(`/api/registers/key_log/${id}`, { status: 'in_progress' })).body.status).toBe('in_progress');
    // An If-Match with the version read before that change is refused, as on built-in types.
    const stale = await t.app.inject({
      method: 'PATCH', url: `/api/registers/key_log/${id}`, payload: { status: 'closed' },
      headers: { cookie: await cookie(), 'x-grc-csrf': '1', 'if-match': String(etag) },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('has history, comments, links, attachments, a fact sheet, search and exports', async () => {
    const history = (await t.api.get(`/api/history?record_type=reg_key_log&record_id=${id}`)).body;
    expect(history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['reg_key_log.create', 'reg_key_log.update']));
    expect((await t.api.post('/api/comments', { record_type: 'reg_key_log', record_id: id, body: 'Returned the spare.' })).status).toBe(201);
    expect((await t.api.get(`/api/attachments?record_type=reg_key_log&record_id=${id}`)).status).toBe(200);
    const pdf = await t.app.inject({ method: 'GET', url: `/api/records/reg_key_log/${id}/pdf`, headers: { cookie: await cookie() } });
    expect(pdf.statusCode).toBe(200);
    const found = (await t.api.get('/api/search?q=gate')).body;
    expect(found.find((r: any) => r.id === id)).toMatchObject({ type: 'reg_key_log', route: '/registers/key_log' });
    const csv = await t.api.get('/api/registers/key_log?format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Depot gate key 14');
    expect(csv.text).toContain('Kind');
  });

  it('imports records from a file', async () => {
    const body = { ...CSV('Key or card,Kind\nStore room key,Key\nWorkshop card,Access card\n'), mapping: { 'Key or card': 'title', Kind: 'cf_kind' }, mode: 'create' };
    const dry = await t.api.post('/api/import/reg_key_log', { ...body, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const real = await t.api.post('/api/import/reg_key_log', { ...body, dryRun: false });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect((await t.api.get('/api/registers/key_log')).body.total).toBe(4);
  });

  it('follows the lifecycle an administrator sets', async () => {
    const saved = await t.api.put('/api/admin/lifecycles/reg_key_log', { blocked: [['closed', 'open']] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const closed = (await t.api.get('/api/registers/key_log?f.status=closed')).body.rows[0];
    const refused = await t.api.patch(`/api/registers/key_log/${closed.id}`, { status: 'open' });
    expect(refused.status).toBe(400);
  });

  it('is in the report builder', async () => {
    const types = (await t.api.get('/api/reports/catalog')).body.types;
    const reg = types.find((x: any) => x.type === 'reg_key_log');
    expect(reg).toBeTruthy();
    expect(reg.fields.map((f: any) => f.path)).toEqual(expect.arrayContaining(['title', 'status', 'cf_kind']));
  });

  it('keeps each register\'s records to itself', async () => {
    expect((await define({ label: 'Visitor', plural: 'Visitors', key: 'visitors', prefix: 'VST' })).status).toBe(201);
    const v = (await t.api.post('/api/registers/visitors', { title: 'Inspector visit' })).body;
    expect(v.ref).toBe('VST-00001');
    expect((await t.api.get(`/api/registers/key_log/${v.id}`)).status).toBe(404);
    expect((await t.api.patch(`/api/registers/key_log/${v.id}`, { title: 'x' })).status).toBe(404);
    expect((await t.api.get('/api/registers/visitors')).body.total).toBe(1);
    const found = (await t.api.get('/api/search?q=inspector')).body;
    expect(found.map((r: any) => r.type)).toEqual(['reg_visitors']);
  });
});

describe('permissions of a register', () => {
  it('are granted by roles like any other permission module', async () => {
    const role = await t.api.post('/api/admin/roles', { name: 'Key desk', grants: ['key_log.view', 'key_log.create'] });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const desk = await t.as('key_desk');
    expect((await desk.get('/api/registers/key_log')).status).toBe(200);
    expect((await desk.post('/api/registers/key_log', { title: 'Locker key 3' })).status).toBe(201);
    const row = (await desk.get('/api/registers/key_log?q=locker')).body.rows[0];
    expect((await desk.patch(`/api/registers/key_log/${row.id}`, { title: 'Locker key 4' })).status).toBe(403);
    expect((await desk.get('/api/registers/key_log?format=csv')).status).toBe(403);
    expect((await desk.get('/api/registers/visitors')).status).toBe(403);
    const meta = (await desk.get('/api/meta')).body.resources;
    expect([Boolean(meta.reg_key_log), Boolean(meta.reg_visitors)]).toEqual([true, false]);
    expect((await desk.get('/api/registers')).body.map((r: any) => r.key)).toEqual(['key_log']);
    expect((await desk.get('/api/admin/registers')).status).toBe(403);
  });
});

describe('switching a register off', () => {
  it('hides it everywhere but Administration > Features, and brings it back', async () => {
    const off = await t.api.patch('/api/admin/features', { features: { reg_key_log: false } });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const list = await t.api.get('/api/registers/key_log');
    expect([list.status, list.body.error.code]).toEqual([404, 'switched_off']);
    expect((await t.api.get('/api/meta')).body.resources.reg_key_log).toBeUndefined();
    expect((await t.api.get('/api/registers')).body.map((r: any) => r.key)).toEqual(['visitors']);
    expect((await t.api.get('/api/search?q=gate')).body.filter((r: any) => r.type === 'reg_key_log')).toEqual([]);
    expect((await t.api.get('/api/admin/registers')).body.registers.map((r: any) => r.key)).toEqual(['visitors']);
    expect((await t.api.get('/api/reports/catalog')).body.types.find((x: any) => x.type === 'reg_key_log')).toBeUndefined();
    expect((await t.api.get('/api/history?record_type=reg_key_log&record_id=00000000-0000-4000-8000-000000000001')).body.error.code).toBe('switched_off');
    expect((await t.api.get('/api/admin/features')).body.areas.find((a: any) => a.key === 'reg_key_log').on).toBe(false);
    // Its custom fields are not listed either (kept, and back when it is switched on).
    const fieldsOf = async () => (await t.api.get('/api/admin/custom-fields')).body.fields.filter((f: any) => f.record_type === 'reg_key_log').length;
    expect(await fieldsOf()).toBe(0);

    expect((await t.api.patch('/api/admin/features', { features: { reg_key_log: true } })).status).toBe(200);
    expect((await t.api.get('/api/registers/key_log')).body.total).toBe(5);
    expect(await fieldsOf()).toBeGreaterThan(0);
  });
});

describe('removing a register', () => {
  it('is refused while it holds records, and takes its fields and grants with it', async () => {
    const busy = await t.api.del('/api/admin/registers/key_log');
    expect([busy.status, busy.body.error.code]).toEqual([409, 'in_use']);

    expect((await define({ label: 'Spare', plural: 'Spares', key: 'spares', prefix: 'SP' })).status).toBe(201);
    await t.api.post('/api/admin/custom-fields', { record_type: 'reg_spares', label: 'Size', key: 'size', type: 'text' });
    await t.api.post('/api/admin/roles', { name: 'Spares desk', grants: ['spares.view'] });
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    const gone = await t.api.del('/api/admin/registers/spares');
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect((await t.api.get('/api/meta')).body.resources.reg_spares).toBeUndefined();
    expect((await t.api.get('/api/registers/spares')).status).toBe(404);
    expect(AREAS.some((a) => a.key === 'reg_spares')).toBe(false);
    expect(await t.db.one(`select 1 from role_permissions where permission like 'spares.%'`)).toBeUndefined();
    expect(await t.db.one(`select 1 from custom_fields where record_type = 'reg_spares'`)).toBeUndefined();
    expect((await t.db.one<{ v: string | null }>(`select to_regclass('reg_spares')::text as v`))?.v).toBeNull();
    // The name is free again.
    expect((await define({ label: 'Spare', plural: 'Spares', key: 'spares', prefix: 'SP' })).status).toBe(201);
  });

  it('takes only its own grants, even when its key is a pattern for another module\'s (W23 F2)', async () => {
    const grants = async (module: string) => (await t.db.one<{ n: number }>(`select count(*)::int as n from role_permissions where split_part(permission, '.', 1) = $1`, [module]))!.n;
    const risks = await grants('risks');
    expect(risks).toBeGreaterThan(0);
    expect((await define({ label: 'Thing', plural: 'Things', key: 'risk_', prefix: 'QQ' })).status).toBe(201);
    await t.api.post('/api/admin/roles', { name: 'Things desk', grants: ['risk_.view'] });
    expect(await grants('risk_')).toBe(1);
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect((await t.api.del('/api/admin/registers/risk_')).status).toBe(200);
    expect(await grants('risk_')).toBe(0);
    expect(await grants('risks')).toBe(risks);
  });

  it('counts its records again under a lock, so a record added meanwhile is not orphaned (W23 F4)', async () => {
    expect((await define({ label: 'Badge', plural: 'Badges', key: 'badges', prefix: 'BDG' })).status).toBe(201);
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    // A record arrives after the first count, while the password and the database account are checked.
    const db = t.db as { query: typeof t.db.query };
    const query = db.query;
    let armed = true;
    db.query = (async (sql: string, params?: unknown[]) => {
      const rows = await query.call(t.db, sql, params);
      if (armed && sql.includes('from register_records group by 1')) {
        armed = false;
        expect((await t.api.post('/api/registers/badges', { title: 'Late badge' })).status).toBe(201);
      }
      return rows;
    }) as typeof t.db.query;
    let res;
    try { res = await t.api.del('/api/admin/registers/badges'); } finally { db.query = query; }
    expect(armed).toBe(false);
    expect([res.status, res.body.error?.code]).toEqual([409, 'in_use']);
    // Not removed: the register and its record are still there.
    expect((await t.api.get('/api/registers/badges')).body.total).toBe(1);
    expect(await t.db.one(`select 1 from register_definitions where key = 'badges'`)).toBeTruthy();
  });

  it('cannot be defined again while records of an earlier register with its key are stored (W23 F4)', async () => {
    await t.db.query(`insert into register_records (register_key, ref, title) values ('ghosts', 'GH-00001', 'Left behind')`);
    const res = await define({ label: 'Ghost', plural: 'Ghosts', key: 'ghosts', prefix: 'GH' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.key).toMatch(/still stored/);
  });
});

async function cookie(): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import('../../core/auth.ts');
  const admin = (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!;
  return `${SESSION_COOKIE}=${await createSession(t.db, admin.id)}`;
}
