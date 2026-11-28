import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';

// E46-70: an employee sees their own certifications and when they expire (My training, My work and the
// mobile app's My work, which reads GET /api/work/mine). E46-72: certifications carry the holder's
// position and department, kept in step with the roster, so the list filters by them. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let coord: Client;
let employee: Client;
let today: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  process.env.GRC_MODULES = 'people,training,work,notifications';
  t = await testApp();
  coord = await t.as('training_coordinator');
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled, requires_mfa) values ('cert_employee', 'Employee', 'Test', true, false) returning id`))!;
  void role;
  employee = await t.as('cert_employee'); // no permission at all
  today = localDate();
  ids.drivers = (await coord.post('/api/positions', { name: 'Invented bus operator' })).body.id;
  ids.maint = (await coord.post('/api/positions', { name: 'Invented mechanic' })).body.id;
  ids.ops = (await coord.post('/api/departments', { name: 'Invented operations' })).body.id;
  ids.shop = (await coord.post('/api/departments', { name: 'Invented workshop' })).body.id;
  await coord.post(`/api/positions/${ids.drivers}/requirements`, { kind: 'certification', certification_type: 'vehicle_operator_license' });
  await coord.post(`/api/positions/${ids.drivers}/requirements`, { kind: 'certification', certification_type: 'first_aid' });
  const p = await coord.post('/api/people', { full_name: 'Casey Example', employee_number: 'E-1', user_id: employee.userId, position_id: ids.drivers, department_id: ids.ops });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  ids.casey = p.body.id;
  ids.dana = (await coord.post('/api/people', { full_name: 'Dana Example', employee_number: 'E-2', position_id: ids.maint, department_id: ids.shop })).body.id;
});
afterAll(async () => { await t.close(); });

const cert = async (person: string, type: string, issued: string, expires: string | null, extra: Record<string, unknown> = {}) => {
  const r = await coord.post('/api/certifications', { person_id: person, certification_type: type, issued_on: issued, expires_on: expires, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('my certifications (E46-70)', () => {
  it('lists the employee\'s own certifications with their expiry, and what the position still needs', async () => {
    ids.old = (await cert(ids.casey, 'vehicle_operator_license', addDays(today, -800), addDays(today, -10))).id;
    ids.soon = (await cert(ids.casey, 'track_access', addDays(today, -300), addDays(today, 12))).id;
    await cert(ids.dana, 'first_aid', addDays(today, -30), addDays(today, 5)); // someone else's
    const mine = await employee.get('/api/training/mine/certifications');
    expect(mine.status).toBe(200);
    expect(mine.body.person).toMatchObject({ full_name: 'Casey Example', position: 'Invented bus operator', department: 'Invented operations' });
    expect(mine.body.rows.map((r: any) => [r.certification_type, r.state])).toEqual([['vehicle_operator_license', 'expired'], ['track_access', 'expiring']]);
    expect(mine.body.rows[1]).toMatchObject({ days_left: 12, label: 'Track access permit' });
    // The license is expired and first aid is missing: both are what the position needs.
    expect(mine.body.missing.map((m: any) => [m.label, m.state]).sort()).toEqual([['Driver or operator license', 'expired'], ['First aid', 'missing']]);
    // Someone with no roster person gets an empty answer, not an error.
    const other = await t.as('agent');
    expect((await other.get('/api/training/mine/certifications')).body).toMatchObject({ person: null, rows: [], missing: [] });
  });

  it('puts the employee\'s own renewals in My work although they hold no training permission', async () => {
    const work = (await employee.get('/api/work/mine?limit=20')).body;
    const section = work.sections.find((s: any) => s.key === 'training.my_certifications');
    expect(section, JSON.stringify(work)).toBeTruthy();
    expect(section.items.map((i: any) => i.recordId).sort()).toEqual([ids.old, ids.soon].sort());
    expect(section.items.every((i: any) => i.url === '/training/mine')).toBe(true);
    expect(section.overdue).toBe(1);
    // A renewal takes the expired one out; the record itself stays readable only to training.
    await cert(ids.casey, 'vehicle_operator_license', addDays(today, -5), addDays(today, 1800));
    const after = (await employee.get('/api/work/mine?limit=20')).body.sections.find((s: any) => s.key === 'training.my_certifications');
    expect(after.items.map((i: any) => i.recordId)).toEqual([ids.soon]);
    expect((await employee.get(`/api/certifications/${ids.soon}`)).status).toBe(403);
    const renewed = (await employee.get('/api/training/mine/certifications')).body.rows.find((r: any) => r.id === ids.old);
    expect(renewed.state).toBe('renewed');
  });

  it('gives a training.view holder each renewal once, from the training source', async () => {
    const p = await coord.post('/api/people', { full_name: 'Coordinator Example', employee_number: 'E-3', user_id: coord.userId });
    await cert(p.body.id, 'first_aid', addDays(today, -100), addDays(today, 3));
    const work = (await coord.get('/api/work/mine?limit=20')).body;
    expect(work.sections.find((s: any) => s.key === 'training.my_certifications')).toBeUndefined();
    expect(work.sections.find((s: any) => s.key === 'training.certifications').items).toHaveLength(1);
  });
});

describe('certifications by position and department (E46-72)', () => {
  it('copies the holder\'s position and department and keeps them in step with the roster', async () => {
    const c = await cert(ids.dana, 'equipment_operator', addDays(today, -10), null);
    expect(c).toMatchObject({ position_id: ids.maint, department_id: ids.shop });
    // A person cannot set them by hand.
    const patched = await coord.patch(`/api/certifications/${c.id}`, { department_id: ids.ops, notes: 'Invented note' });
    expect(patched.status).toBe(200);
    expect(patched.body.department_id).toBe(ids.shop);
    // Dana moves to operations as a bus operator: every certification follows.
    expect((await coord.patch(`/api/people/${ids.dana}`, { department_id: ids.ops, position_id: ids.drivers })).status).toBe(200);
    const list = await coord.get(`/api/certifications?f.department_id=${ids.ops}&pageSize=100`);
    expect(list.body.rows.every((r: any) => r.department_id === ids.ops)).toBe(true);
    expect(list.body.rows.map((r: any) => r.person_id)).toContain(ids.dana);
    expect((await coord.get(`/api/certifications?f.department_id=${ids.shop}`)).body.total).toBe(0);
    const byPos = await coord.get(`/api/certifications?f.position_id=${ids.drivers}&pageSize=100`);
    expect(new Set(byPos.body.rows.map((r: any) => r.person_id))).toEqual(new Set([ids.casey, ids.dana]));
    expect((await coord.get(`/api/certifications/stats?group=department_id`)).body.groups.find((g: any) => g.value === ids.ops)?.label).toBe('Invented operations');
  });

  it('filters the expiring list by position or department, and refuses a bad filter', async () => {
    const byDept = await coord.get(`/api/training/certifications/expiring?days=90&department=${ids.ops}`);
    expect(byDept.status).toBe(200);
    expect(byDept.body.rows.length).toBeGreaterThan(0);
    expect(byDept.body.rows.every((r: any) => r.department === 'Invented operations')).toBe(true);
    expect((await coord.get(`/api/training/certifications/expiring?days=90&position=${ids.maint}`)).body.rows).toHaveLength(0);
    expect((await coord.get('/api/training/certifications/expiring?position=nope')).status).toBe(400);
  });
});
