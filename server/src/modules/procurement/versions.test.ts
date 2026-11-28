import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Budget amendments kept as versions (E46-67). Invented names only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let officer: Client;
let viewer: Client;

beforeAll(async () => {
  t = await testApp();
  const role = await t.db.one<Row>(`insert into roles (key, name, enabled) values ('bv_viewer', 'bv_viewer', true) returning id`);
  await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'procurement.view'), ($1, 'procurement.create')`, [role!.id]);
  officer = await t.as('procurement_officer');
  viewer = await t.as('bv_viewer');
}, 60_000);
afterAll(async () => { await t?.close(); });

const newBudget = async (name: string, lines: [string, number][]) => {
  const b = (await officer.post('/api/budgets', { name, fiscal_year: 'FY Invented' })).body;
  const ls: Row[] = [];
  for (const [title, amount] of lines) ls.push((await officer.post('/api/budget-lines', { budget_id: b.id, title, amount })).body);
  return { b, ls };
};
const amounts = async (budgetId: string) => Object.fromEntries(((await viewer.get(`/api/budgets/${budgetId}/figures`)).body.lines as Row[]).map((l) => [l.title, l.amount]));

describe('budget versions', () => {
  it('record the adoption, then amendments that change the lines, with the history kept', async () => {
    const { b, ls } = await newBudget('Invented budget A', [['Fuel', 1000], ['Tires', 500]]);
    // Adopted and Amended come from recording versions.
    expect((await officer.patch(`/api/budgets/${b.id}`, { status: 'adopted' })).status).toBe(400);
    expect((await viewer.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted', decision: 'x' })).status).toBe(403);
    expect((await officer.post('/api/budget-versions', { budget_id: b.id, kind: 'amendment', decision: 'x', reason: 'x', changes: [{ budget_line_id: ls[0].id, amount: 1 }] })).body.error.fields.kind).toMatch(/adoption/);
    expect((await officer.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted' })).body.error.fields.decision).toBeTruthy();
    expect((await officer.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted', decision: 'x', approved_on: dayInZone(3) })).body.error.fields.approved_on).toBeTruthy();

    const adopted = await officer.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted', approved_on: dayInZone(-30), decision: 'Invented resolution 1', reason: 'As adopted.' });
    expect(adopted.status, JSON.stringify(adopted.body)).toBe(201);
    expect(adopted.body).toMatchObject({ version_no: 0, title: 'Adopted budget', effective_on: dayInZone(-30), recorded_by: officer.userId });
    const ab = (await viewer.get(`/api/budget-versions/${adopted.body.id}`)).body;
    expect(Number(ab.total_after)).toBe(1500);
    expect((await viewer.get(`/api/budgets/${b.id}`)).body.status).toBe('adopted');
    expect((await officer.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted', decision: 'again' })).status).toBe(400);

    // Amounts change only by amendment.
    expect((await officer.patch(`/api/budget-lines/${ls[0].id}`, { amount: 2000 })).status).toBe(400);
    expect((await officer.patch(`/api/budget-lines/${ls[0].id}`, { account: '50-1' })).status).toBe(200);
    expect((await officer.post('/api/budget-lines', { budget_id: b.id, title: 'Late line', amount: 1 })).status).toBe(400);
    expect((await officer.del(`/api/budget-lines/${ls[1].id}`)).status).toBe(409);

    const noReason = await officer.post('/api/budget-versions', { budget_id: b.id, decision: 'Invented resolution 2', changes: [{ budget_line_id: ls[0].id, amount: 1200 }] });
    expect(noReason.body.error.fields.reason).toBeTruthy();
    const same = await officer.post('/api/budget-versions', { budget_id: b.id, decision: 'R', reason: 'r', changes: [{ budget_line_id: ls[0].id, amount: 1000 }] });
    expect(same.body.error.fields.changes).toMatch(/at least one/);
    const below = await officer.post('/api/budget-versions', { budget_id: b.id, decision: 'R', reason: 'r', changes: [{ budget_line_id: ls[1].id, change: -600 }] });
    expect(below.body.error.fields.changes).toMatch(/below zero/);
    const early = await officer.post('/api/budget-versions', { budget_id: b.id, decision: 'R', reason: 'r', effective_on: dayInZone(-40), changes: [{ budget_line_id: ls[0].id, amount: 1 }] });
    expect(early.body.error.fields.effective_on).toMatch(/in order/);

    const one = await officer.post('/api/budget-versions', {
      budget_id: b.id, approved_on: dayInZone(-10), decision: 'Invented resolution 2', reason: 'Fuel prices rose.',
      changes: [{ budget_line_id: ls[0].id, change: 250 }, { budget_line_id: ls[1].id, amount: 400 }, { title: 'Invented chargers', kind: 'capital', account: '70-9', amount: 3000 }],
    });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.body).toMatchObject({ version_no: 1, title: 'Amendment 1', kind: 'amendment' });
    expect(await amounts(b.id)).toEqual({ Fuel: 1250, Tires: 400, 'Invented chargers': 3000 });
    expect((await viewer.get(`/api/budgets/${b.id}`)).body.status).toBe('amended');
    const fig = (await viewer.get(`/api/budgets/${b.id}/figures`)).body;
    expect(fig.totals).toMatchObject({ amount: 4650, adopted: 1500 });
    expect(fig.lines.find((l: Row) => l.title === 'Fuel')).toMatchObject({ adopted: 1000, amount: 1250 });
    expect(fig.lines.find((l: Row) => l.title === 'Invented chargers').adopted).toBeNull();

    const two = await officer.post('/api/budget-versions', { budget_id: b.id, decision: 'Invented resolution 3', reason: 'Tires deferred.', changes: [{ budget_line_id: ls[1].id, amount: 0 }] });
    expect(two.status, JSON.stringify(two.body)).toBe(201);

    // The history: every version with its totals and each line's amount in it.
    const h = (await viewer.get(`/api/budgets/${b.id}/versions`)).body;
    expect(h.current_version).toBe(2);
    expect(h.versions.map((v: Row) => [v.title, v.total_before, v.total_after, v.change])).toEqual([
      ['Adopted budget', 1500, 1500, 0], ['Amendment 1', 1500, 4650, 3150], ['Amendment 2', 4650, 4250, -400],
    ]);
    expect(h.lines.find((l: Row) => l.title === 'Tires').amounts).toEqual([500, 400, 0]);
    expect(h.lines.find((l: Row) => l.title === 'Invented chargers').amounts).toEqual([null, 3000, 3000]);
    const vl = (await viewer.get(`/api/budget-versions/${one.body.id}/lines`)).body;
    expect(vl.lines.find((l: Row) => l.title === 'Invented chargers')).toMatchObject({ added: true, amount_before: null, amount_after: 3000 });
    expect(vl.lines.find((l: Row) => l.title === 'Fuel')).toMatchObject({ amount_before: 1000, amount_after: 1250, change: 250 });
    expect((await t.api.get(`/api/budget-versions/${one.body.id}`)).body.changes).toHaveLength(3);

    // A recorded version stays as it was; its words can be corrected.
    expect((await officer.patch(`/api/budget-versions/${one.body.id}`, { changes: [] })).status).toBe(400);
    expect((await officer.patch(`/api/budget-versions/${one.body.id}`, { effective_on: dayInZone(-1) })).status).toBe(400);
    expect((await officer.patch(`/api/budget-versions/${one.body.id}`, { decision: 'Invented resolution 2 (corrected)' })).status).toBe(200);

    // Only the latest is removed, and the lines go back.
    expect((await officer.del(`/api/budget-versions/${one.body.id}`)).status).toBe(409);
    expect((await officer.del(`/api/budget-versions/${two.body.id}`)).status).toBe(200);
    expect(await amounts(b.id)).toEqual({ Fuel: 1250, Tires: 400, 'Invented chargers': 3000 });
    expect((await officer.del(`/api/budget-versions/${one.body.id}`)).status).toBe(200);
    expect(await amounts(b.id)).toEqual({ Fuel: 1000, Tires: 500 });
    expect((await viewer.get(`/api/budgets/${b.id}`)).body.status).toBe('adopted');
  });

  it('load past adoptions and amendments with their dates and the people named, and undo them', async () => {
    await t.db.query(`insert into users (username, email, display_name, status) values ('oldtreasurer', 'old.treasurer@example.test', 'Tess Oldtreasurer', 'disabled')`);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    let undoDay = '';
    try {
      const b = (await t.api.post('/api/budgets', { name: 'Invented budget 2019', fiscal_year: 'FY 2019', starts_on: '2019-01-01', ends_on: '2019-12-31', status: 'closed', created_at: '2018-11-01T10:00:00Z' })).body;
      const fuel = (await t.api.post('/api/budget-lines', { budget_id: b.id, title: 'Fuel 2019', amount: 9000 })).body;
      const v0 = await t.api.post('/api/budget-versions', { budget_id: b.id, kind: 'adopted', approved_on: '2018-12-12', decision: 'Invented resolution 2018-40', on_behalf_of: 'oldtreasurer', created_at: '2018-12-12T18:00:00Z' });
      expect(v0.status, JSON.stringify(v0.body)).toBe(201);
      expect(v0.body).toMatchObject({ effective_on: '2018-12-12', recorded_by_name: 'Tess Oldtreasurer' });
      const v1 = await t.api.post('/api/budget-versions', { budget_id: b.id, approved_on: '2019-06-20', decision: 'Invented resolution 2019-22', reason: 'Fuel prices.', changes: [{ budget_line_id: fuel.id, amount: 9900 }], on_behalf_of: 'oldtreasurer' });
      expect(v1.status, JSON.stringify(v1.body)).toBe(201);
      // A closed budget stays closed; its lines hold the latest version.
      expect((await t.api.get(`/api/budgets/${b.id}`)).body.status).toBe('closed');
      expect(Number((await t.api.get(`/api/budget-lines/${fuel.id}`)).body.amount)).toBe(9900);
      undoDay = dayInZone();
      const undo = await t.api.post('/api/admin/data-load/undo', { type: 'budget_version', day: undoDay });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      {
        expect(Number((await t.api.get(`/api/budget-lines/${fuel.id}`)).body.amount)).toBe(9000);
        expect((await t.api.get(`/api/budgets/${b.id}/versions`)).body.versions).toHaveLength(0);
      }
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});
