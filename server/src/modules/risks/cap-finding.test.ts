// E45-18: a corrective action plan raised from an audit finding closes only after an auditor has
// verified that finding; once verified, a plan whose actions are all done closes by itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let second: Client;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => {
  process.env.GRC_MODULES = 'audits,risks,controls,workflows,notifications,attachments,work';
  t = await testApp();
  lead = await t.as('audit_lead');
  second = await t.as('audit_lead');
}, 120_000);
afterAll(async () => { delete process.env.GRC_MODULES; await t?.close(); });

describe('corrective action plan from an audit finding', () => {
  it('closes only after the finding is verified, then closes by itself', async () => {
    const audit = (await lead.post('/api/audits', { title: 'Invented audit of key control', audit_type: 'internal_audit', lead_auditor_id: second.userId })).body;
    const f = (await lead.post('/api/audit-findings', { title: 'Invented gap in key issue', source_type: 'audit_engagement', source_id: audit.id })).body;
    const cap = (await lead.post(`/api/audit-findings/${f.id}/cap`, {})).body.cap;
    expect((await t.api.get(`/api/caps/${cap.id}`)).body.source_type).toBe('audit_finding');
    // The plan's own approval steps are skipped by loading it as in progress with one finished action.
    await loadMode(true);
    try {
      const action = await t.api.post('/api/actions', { title: 'Invented fix of the key issue', cap_id: cap.id, status: 'done', source: 'audit', due_on: '2026-01-31' });
      expect(action.status, JSON.stringify(action.body)).toBe(201);
      expect((await t.api.patch(`/api/caps/${cap.id}`, { status: 'in_progress' })).status).toBe(200);
    } finally { await loadMode(false); }

    // A person cannot close it while the finding waits for the auditor.
    const refused = await t.api.patch(`/api/caps/${cap.id}`, { status: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('finding_not_verified');

    // The auditor verifies the finding; the plan, whose actions are done, closes.
    await t.db.query(`update caps set status = 'verifying' where id = $1`, [cap.id]);
    const file = await second.post('/api/attachments/link', { record_type: 'audit_finding', record_id: f.id, url: 'https://documents.example.test/key-log', title: 'Key issue log sample', evidence: true });
    expect(file.status).toBe(201);
    const done = await second.post(`/api/audit-findings/${f.id}/verify`, { note: 'Sampled the key log.', attachment_ids: [file.body.id] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const after = (await t.api.get(`/api/caps/${cap.id}`)).body;
    expect(after.status).toBe('closed');
  });
});
