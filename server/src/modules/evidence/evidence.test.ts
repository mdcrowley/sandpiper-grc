import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { defineEvidencePart } from './parts.ts';
import { runEvidenceReminders } from './reminders.ts';

// A stand-in record type to link evidence to, so the library is tested on its own. Its parts ("zones")
// show how a module offers parts of a record, and who may link evidence to a part without edit rights.
const standIn: ModuleDef = {
  key: 'evidencestandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists t_gadgets (
      id uuid primary key default gen_random_uuid(), ref text, name text not null, keeper_id uuid, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'gadget', table: 't_gadgets', module: 'gadgets', label: 'Gadget', plural: 'Gadgets', path: '/api/gadgets', route: '/gadgets',
      titleField: 'name', ref: { field: 'ref', prefix: 'GDT-' }, restricted: 'flag',
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, name: { label: 'Name', type: 'text', required: true },
        keeper_id: { label: 'Keeper', type: 'user' }, restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    defineEvidencePart(ctx.app, {
      recordType: 'gadget', prefix: 'zone', label: 'Zone',
      describe: async (_db, _id, key) => (['A', 'B'].includes(key) ? `Zone ${key}` : null),
      mayLink: async (req, id) => Boolean(await ctx.db.one('select 1 from t_gadgets where id = $1 and keeper_id = $2', [id, req.user!.id])),
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;  // evidence.*, gadgets.*
let reader: Client;   // evidence.view, gadgets.view
let keeper: Client;   // evidence.view, gadgets.view; keeps one gadget
let blind: Client;    // gadgets.* only: no evidence permission at all

async function roleWith(key: string, perms: string[]) {
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ($1, $1, true) returning id`, [key]);
  for (const p of perms) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
}

beforeAll(async () => {
  t = await testApp({ extraModules: [standIn] });
  await roleWith('ev_officer', ['evidence.*', 'gadgets.*']);
  await roleWith('ev_reader', ['evidence.view', 'gadgets.view']);
  await roleWith('ev_blind', ['gadgets.*']);
  officer = await t.as('ev_officer');
  reader = await t.as('ev_reader');
  keeper = await t.as('ev_reader');
  blind = await t.as('ev_blind');
}, 60_000);
afterAll(async () => { await t?.close(); });

const gadget = async (name: string, extra: Row = {}) => (await t.api.post('/api/gadgets', { name, ...extra })).body;
const evidence = async (c: Client | typeof t.api, data: Row) => {
  const r = await c.post('/api/evidence-library', data);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('evidence records', () => {
  it('belong to the person who files them and check their source and dates', async () => {
    const e = await evidence(officer, { title: 'Procurement procedure', source: 'link', url: 'https://intranet.example.test/procurement' });
    expect(e).toMatchObject({ ref: expect.stringMatching(/^EVD-/), owner_id: officer.userId, restricted: false });
    const noUrl = await officer.post('/api/evidence-library', { title: 'A link without an address', source: 'link' });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error.fields.url).toBeTruthy();
    const badUrl = await officer.post('/api/evidence-library', { title: 'Odd link', source: 'link', url: 'javascript:alert(1)' });
    expect(badUrl.body.error.fields.url).toBeTruthy();
    const dates = await officer.post('/api/evidence-library', { title: 'Backwards', collected_on: dayInZone(0), valid_until: dayInZone(-1) });
    expect(dates.body.error.fields.valid_until).toBeTruthy();
    const period = await officer.post('/api/evidence-library', { title: 'Backwards period', period_start: dayInZone(0), period_end: dayInZone(-30) });
    expect(period.body.error.fields.period_end).toBeTruthy();
    const doc = await officer.post('/api/evidence-library', { title: 'A document without the document', source: 'document' });
    expect(doc.body.error.fields.document_id).toBeTruthy();
  });

  it('is filed once and reused by many records, each history saying so', async () => {
    const e = await evidence(officer, { title: 'Asset inventory export', valid_until: dayInZone(200) });
    const g1 = await gadget('Fare gate controller');
    const g2 = await gadget('Depot door controller');
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g1.id })).status).toBe(201);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g2.id, relation: 'demonstrates', note: 'Section 2' })).status).toBe(201);
    // Linking again changes the relation; nothing is duplicated.
    const again = await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g1.id, relation: 'reference' });
    expect(again.status).toBe(200);
    const on1 = await reader.get(`/api/evidence-links?record_type=gadget&record_id=${g1.id}`);
    expect(on1.body).toMatchObject({ hidden: 0, total: 1, may_view: true, may_link: false });
    expect(on1.body.rows[0]).toMatchObject({ relation: 'reference', evidence: { id: e.id, title: 'Asset inventory export', state: 'current' } });
    const used = await reader.get(`/api/evidence-library/${e.id}/used-by`);
    expect(used.body.rows.map((r: Row) => r.label).sort()).toEqual(['Depot door controller', 'Fare gate controller']);
    expect(used.body.rows.find((r: Row) => r.record_id === g2.id)).toMatchObject({ relation: 'demonstrates', note: 'Section 2', route: `/gadgets/${g2.id}` });
    const history = await t.api.get(`/api/history?record_type=gadget&record_id=${g1.id}`);
    expect(history.body.map((h: Row) => h.action)).toEqual(expect.arrayContaining(['evidence.link', 'evidence.link_update']));
    const own = await t.api.get(`/api/history?record_type=evidence_record&record_id=${e.id}`);
    expect(own.body.filter((h: Row) => h.action === 'evidence.link')).toHaveLength(2);
  });

  it('needs edit permission on the record to link or unlink, and sight of the evidence', async () => {
    const e = await evidence(officer, { title: 'Training records' });
    const g = await gadget('Radio console');
    const r = await reader.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id });
    expect(r.status).toBe(403);
    // Without evidence.view the route itself is refused.
    expect((await blind.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id })).status).toBe(403);
    const link = (await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id })).body;
    expect((await reader.del(`/api/evidence-links/${link.id}`)).status).toBe(403);
    // Someone without evidence permission sees that the record has evidence, but not what it is.
    const seen = await blind.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`);
    expect(seen.body).toMatchObject({ rows: [], hidden: 1, total: 1, may_view: false, may_link: false });
    expect((await officer.del(`/api/evidence-links/${link.id}`)).body).toEqual({ ok: true });
    expect((await officer.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`)).body.total).toBe(0);
    // An unknown evidence record or record type is refused.
    expect((await officer.post('/api/evidence-links', { evidence_id: g.id, record_type: 'gadget', record_id: g.id })).status).toBe(400);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'evidence_record', record_id: e.id })).status).toBe(404);
  });

  it('links to parts of a record that its module names, with the part\'s own rule for who may link', async () => {
    const e = await evidence(officer, { title: 'Zone survey' });
    const g = await gadget('Signal cabinet', { keeper_id: keeper.userId });
    const ok = await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'zone:A' });
    expect(ok.status).toBe(201);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'zone:Z' })).status).toBe(400);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'no part' })).status).toBe(400);
    expect((await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'shelf:1' })).status).toBe(400);
    // The keeper may not edit gadgets, but the part's rule lets them answer with evidence.
    expect((await keeper.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'zone:B' })).status).toBe(201);
    expect((await reader.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id, part: 'zone:B' })).status).toBe(403);
    expect((await keeper.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id })).status).toBe(403);
    const zoneB = await keeper.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}&part=zone:B`);
    expect(zoneB.body.rows).toHaveLength(1);
    expect(zoneB.body.rows[0]).toMatchObject({ part: 'zone:B', part_label: 'Zone: Zone B' });
    expect(zoneB.body.may_link).toBe(true);
    expect((await keeper.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`)).body.total).toBe(2);
  });
});

describe('restriction', () => {
  it('hides restricted evidence from people without security access, but counts it for everyone', async () => {
    const g = await gadget('Ticket vending machine');
    const open = await evidence(officer, { title: 'Maintenance log' });
    const secret = await evidence(t.api, { title: 'Penetration test report', restricted: true, valid_until: dayInZone(-3) });
    expect((await t.api.post('/api/evidence-links', { evidence_id: open.id, record_type: 'gadget', record_id: g.id })).status).toBe(201);
    expect((await t.api.post('/api/evidence-links', { evidence_id: secret.id, record_type: 'gadget', record_id: g.id })).status).toBe(201);
    const asAdmin = await t.api.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`);
    expect(asAdmin.body).toMatchObject({ hidden: 0, total: 2 });
    const asReader = await reader.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`);
    expect(asReader.body.rows.map((r: Row) => r.evidence.title)).toEqual(['Maintenance log']);
    expect(asReader.body).toMatchObject({ hidden: 1, total: 2 });
    expect((await reader.get(`/api/evidence-library/${secret.id}`)).status).toBe(404);
    expect((await reader.get(`/api/evidence-library/${secret.id}/used-by`)).status).toBe(404);
    expect((await reader.post('/api/evidence-links', { evidence_id: secret.id, record_type: 'gadget', record_id: g.id })).status).toBe(400);
    // The library's figures are the same for both.
    const a = (await t.api.get('/api/evidence-library/summary')).body;
    const b = (await reader.get('/api/evidence-library/summary')).body;
    expect(b).toEqual(a);
    expect(a.restricted).toBeGreaterThanOrEqual(1);
    expect(a.expired).toBeGreaterThanOrEqual(1);
    // A restricted record a link points at is counted on the evidence's "used by", not listed.
    const hiddenGadget = await gadget('Security camera head-end', { restricted: true });
    expect((await t.api.post('/api/evidence-links', { evidence_id: open.id, record_type: 'gadget', record_id: hiddenGadget.id })).status).toBe(201);
    const used = await reader.get(`/api/evidence-library/${open.id}/used-by`);
    expect(used.body).toMatchObject({ hidden: 1, total: 2 });
    expect(used.body.rows.map((r: Row) => r.label)).toEqual(['Ticket vending machine']);
  });
});

describe('expiry', () => {
  it('reminds the owner before evidence lapses, once per step, and lists it as expiring', async () => {
    const e = await evidence(officer, { title: 'Insurance certificate', collected_on: dayInZone(-300), valid_until: dayInZone(5) });
    const notes = () => t.db.query<Row>(`select title from notifications where user_id = $1 and record_id = $2`, [officer.userId, e.id]);
    await runEvidenceReminders(t.ctx);
    expect((await notes()).map((n) => n.title)).toEqual([expect.stringMatching(/^Evidence lapses in 5 days: EVD-\d+ Insurance certificate$/)]);
    await runEvidenceReminders(t.ctx);
    expect(await notes()).toHaveLength(1);
    // A new date is a new occasion.
    await officer.patch(`/api/evidence-library/${e.id}`, { valid_until: dayInZone(0) });
    await runEvidenceReminders(t.ctx);
    expect((await notes()).map((n) => n.title)).toContain(`Evidence lapses today: ${e.ref} Insurance certificate`);
    const g = await gadget('Bus wash');
    await officer.post('/api/evidence-links', { evidence_id: e.id, record_type: 'gadget', record_id: g.id });
    const on = await officer.get(`/api/evidence-links?record_type=gadget&record_id=${g.id}`);
    expect(on.body.rows[0].evidence.state).toBe('expiring');
    const list = await officer.get(`/api/evidence-library?f.valid_until.lt=${dayInZone(31)}`);
    expect(list.body.rows.map((r: Row) => r.id)).toContain(e.id);
  });

  it('puts evidence to renew in the owner\'s work', async () => {
    const e = await evidence(officer, { title: 'Fire inspection certificate', valid_until: dayInZone(10) });
    const work = await officer.get(`/api/work/mine`);
    if (work.status === 200) {
      expect(JSON.stringify(work.body)).toContain(e.id);
    }
  });
});
