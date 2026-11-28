import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 26 (E46): retiring a vehicle needs an approval, as disposing of an asset does. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let requester: Client;
let approver: Client;
let viewer: Client;

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

beforeAll(async () => {
  process.env.GRC_MODULES = 'fleet,inventory,workflows,notifications,admin';
  t = await testApp();
  requester = await withGrants('t_fleet_clerk', ['fleet.view', 'fleet.edit', 'sites.view']);
  approver = await withGrants('t_fleet_boss', ['fleet.view', 'fleet.edit', 'fleet.approve', 'sites.view']);
  viewer = await withGrants('t_fleet_view', ['fleet.view']);
}, 60_000);
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

const vehicle = async (fleet_number: string, extra: Row = {}) => {
  const res = await t.api.post('/api/vehicles', { fleet_number, mode: 'bus', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Row;
};

describe('vehicle retirement', () => {
  it('refuses the Retired status without an approval, then routes a request and retires once approved', async () => {
    const v = await vehicle('R-5001');
    const direct = await requester.patch(`/api/vehicles/${v.id}`, { status: 'retired' });
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe('retirement_not_approved');
    expect((await t.api.post('/api/vehicles', { fleet_number: 'R-5002', mode: 'bus', status: 'retired' })).status).toBe(400);

    expect((await requester.post(`/api/vehicles/${v.id}/retirement-requests`, {})).status).toBe(400);
    expect((await viewer.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'x' })).status).toBe(403);
    const asked = await requester.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'End of useful life; corrosion.', method: 'auction', expected_proceeds: 4500 });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect(asked.body.workflow).toBe('Vehicle retirement');
    expect((await requester.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'Again' })).body.error.code).toBe('already_requested');
    let rec = (await t.api.get(`/api/vehicles/${v.id}`)).body;
    expect(rec.retirement_request_status).toBe('pending');
    expect(rec.retirement_method).toBe('auction');

    // The requester cannot decide; someone with fleet.approve can.
    expect((await requester.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/decision`, { decision: 'approve' })).status).toBe(403);
    const list = await approver.get(`/api/vehicles/${v.id}/retirement-requests`);
    expect(list.body.requests[0].workflow.can_decide).toBe(true);
    const decided = await approver.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/decision`, { decision: 'approve', comment: 'Agreed.' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.status).toBe('approved');
    rec = (await t.api.get(`/api/vehicles/${v.id}`)).body;
    expect(rec.retirement_request_status).toBe('approved');
    expect(rec.retirement_approved_on).toBe(dayInZone());

    const retired = await requester.patch(`/api/vehicles/${v.id}`, { status: 'retired', retirement_proceeds: 4200 });
    expect(retired.status, JSON.stringify(retired.body)).toBe(200);
    expect(retired.body.retired_on).toBe(dayInZone());
    expect((await requester.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'x' })).body.error.code).toBe('already_retired');
  });

  it('needs the funder\'s approval reference when a funder keeps an interest, and a reason to refuse', async () => {
    const v = await vehicle('R-5003', { funder_interest: true, funder_interest_pct: 80 });
    const asked = await requester.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'Replaced by a newer bus.' });
    expect((await approver.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/decision`, { decision: 'refuse' })).status).toBe(400);
    // Two steps: the fleet manager, then the funder's approval by another person.
    await approver.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/decision`, { decision: 'approve' });
    expect((await t.api.get(`/api/vehicles/${v.id}`)).body.retirement_request_status).toBe('pending');
    const second = await t.api.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/decision`, { decision: 'approve' });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await t.api.get(`/api/vehicles/${v.id}`)).body.retirement_request_status).toBe('approved');
    const noRef = await requester.patch(`/api/vehicles/${v.id}`, { status: 'retired' });
    expect(noRef.status).toBe(400);
    expect(noRef.body.error.fields.retirement_funder_ref).toBeTruthy();
    expect((await requester.patch(`/api/vehicles/${v.id}`, { status: 'retired', retirement_funder_ref: 'FUND-LTR-0091' })).status).toBe(200);
  });

  it('lets a request be withdrawn', async () => {
    const v = await vehicle('R-5004');
    const asked = await requester.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'Surplus.' });
    const w = await requester.post(`/api/vehicles/${v.id}/retirement-requests/${asked.body.id}/withdraw`, {});
    expect(w.status).toBe(200);
    expect(w.body.status).toBe('withdrawn');
    expect((await t.api.get(`/api/vehicles/${v.id}`)).body.retirement_request_status).toBeNull();
  });

  it('accepts a retired vehicle in data load mode, with the request of the person named', async () => {
    const former = (await t.db.one<{ id: string }>(
      `insert into users (username, email, display_name, status) values ('fclerk', 'f.clerk@example.test', 'Fran Clerk', 'disabled') returning id`))!.id;
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const old = await t.api.post('/api/vehicles', { fleet_number: 'R-1999', mode: 'bus', status: 'retired', retired_on: '2021-06-30', retirement_method: 'scrap', retirement_approved_by: 'Former manager', retirement_request_status: 'approved' });
      expect(old.status, JSON.stringify(old.body)).toBe(201);
      expect(old.body.retired_on).toBe('2021-06-30');
      const v = await vehicle('R-5005');
      const asked = await t.api.post(`/api/vehicles/${v.id}/retirement-requests`, { reason: 'Loaded request.', requested_at: '2023-04-01T10:00:00Z', on_behalf_of: 'fclerk' });
      expect(asked.status, JSON.stringify(asked.body)).toBe(201);
      expect(asked.body.requested_by).toBe(former);
      expect(new Date(asked.body.requested_at).toISOString()).toBe('2023-04-01T10:00:00.000Z');
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
  });
});
