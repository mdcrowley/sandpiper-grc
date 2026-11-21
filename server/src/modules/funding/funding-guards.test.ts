import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import mod from './index.ts';

// Funding on its own: no obligations register (C5), no corrective action plans (C1), no approval
// workflows and no contracts. Everything that leans on them says so instead of failing.
let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  process.env.GRC_MODULES = 'funding';
  t = await testApp();
}, 60_000);
afterAll(async () => { await t.close(); });

describe('funding without the modules it can use', () => {
  it('saves awards and explains what is missing', async () => {
    const a = await t.api.post('/api/funding-awards', { title: 'Invented award', status: 'active', reporting_frequency: 'quarterly', next_report_due: '2027-01-15' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect((await t.api.get(`/api/funding-awards/${a.body.id}/obligations`)).body).toMatchObject({ available: false, rows: [] });
    const made = await t.api.post(`/api/funding-awards/${a.body.id}/obligations`);
    expect(made.status).toBe(409);
    expect((await t.api.get(`/api/funding-awards/${a.body.id}/funded-items`)).body.types).toEqual([]);
  });

  it('cannot raise a corrective action plan or ask for a signature', async () => {
    const r = await t.api.post('/api/compliance-reviews', { title: 'Invented review' });
    const d = await t.api.post('/api/review-deficiencies', { title: 'Invented gap', review_id: r.body.id });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect((await t.api.post(`/api/review-deficiencies/${d.body.id}/cap`)).body.error.code).toBe('caps_unavailable');
    // Without a plan the deficiency closes by hand.
    expect((await t.api.patch(`/api/review-deficiencies/${d.body.id}`, { status: 'closed' })).body.status).toBe('closed');
    const c = await t.api.post('/api/funding-certifications', { year: 2027, title: 'Invented certification', signer_id: (await t.db.one<any>('select id from users limit 1')).id });
    await t.api.post(`/api/funding-certifications/${c.body.id}/items`, { statement: 'Invented statement' });
    const items = (await t.api.get(`/api/funding-certifications/${c.body.id}/items`)).body.items;
    await t.api.post(`/api/funding-certifications/${c.body.id}/items/${items[0].id}/confirm`);
    expect((await t.api.post(`/api/funding-certifications/${c.body.id}/sign-request`)).body.error.code).toBe('approvals_unavailable');
    expect((await t.api.get('/api/funding/contracts/00000000-0000-4000-8000-000000000000/clauses')).status).toBe(404);
  });

  it('loads sample data without the other modules', async () => {
    const out = await mod.seed!(t.ctx, { profile: 'dev', seedDir: 'none', organization: {} });
    expect(out).toMatch(/awards 4/);
    expect(out).toMatch(/0 plans/);
    expect(out).toMatch(/none yet/);
  });
});
