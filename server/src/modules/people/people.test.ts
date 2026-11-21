import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let deptId: string;

beforeAll(async () => {
  process.env.GRC_MODULES = 'people';
  t = await testApp();
  deptId = (await t.db.one<{ id: string }>(`insert into departments (name) values ('Invented Operations') returning id`))!.id;
});
afterAll(async () => { await t.close(); });

describe('roster (contract C4)', () => {
  it('creates people with PER- numbers, a department by name and a position', async () => {
    const pos = await t.api.post('/api/positions', { name: 'Invented bus operator', safety_sensitive: true, department_id: 'invented operations' });
    expect(pos.status).toBe(201);
    expect(pos.body.ref).toBe('POS-00001');
    expect(pos.body.department_id).toBe(deptId);
    const res = await t.api.post('/api/people', { full_name: 'Avery Example', employee_number: 'E100', department_id: 'Invented Operations', position_id: pos.body.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ref: 'PER-00001', status: 'active', source: 'manual', department_id: deptId });
    expect(res.body._display.position_id).toBe('Invented bus operator');
  });

  it('refuses a second person with the same employee number, email or account, and an unknown department', async () => {
    expect((await t.api.post('/api/people', { full_name: 'Other Example', employee_number: 'e100' })).body.error.fields.employee_number).toMatch(/already/);
    expect((await t.api.post('/api/people', { full_name: 'Other Example', department_id: 'Nowhere' })).body.error.fields.department_id).toMatch(/not in the department list/);
    const a = await t.api.post('/api/people', { full_name: 'Casey Example', email: 'casey@example.test' });
    expect(a.status).toBe(201);
    expect((await t.api.post('/api/people', { full_name: 'Casey Again', email: 'CASEY@example.test' })).body.error.fields.email).toMatch(/Another person/);
    expect((await t.api.post('/api/positions', { name: 'invented BUS operator' })).status).toBe(400);
  });

  it('links the account with the same email', async () => {
    const admin = await t.db.one<{ id: string; email: string }>('select id, email from users order by created_at limit 1');
    const res = await t.api.post('/api/people', { full_name: 'The Administrator', email: admin!.email });
    expect(res.body.user_id).toBe(admin!.id);
    expect((await t.api.post('/api/people', { full_name: 'Someone', user_id: admin!.id })).body.error.fields.user_id).toMatch(/another person/);
  });

  it('marks names and contacts personal, so anonymizing removes them', async () => {
    const res = await t.api.get('/api/admin/retention');
    const person = res.body.types.find((x: any) => x.type === 'person');
    expect(person.personalFields).toEqual(expect.arrayContaining(['Full name', 'Preferred name', 'Employee number', 'Email', 'Phone', 'Account', 'Hire date', 'Notes']));
    expect(person.personalFields).not.toContain('Department');
  });

  it('needs people permissions', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/people')).status).toBe(403);
    const coord = await t.as('training_coordinator');
    expect((await coord.get('/api/people')).status).toBe(200);
    expect((await coord.get('/api/people/departments')).body.map((d: any) => d.name)).toContain('Invented Operations');
  });
});
