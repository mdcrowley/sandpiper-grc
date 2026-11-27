import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { loadOrganizationRules } from './defaults.ts';

// E45-34: the next-stage button and the checks each stage needs. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await loadOrganizationRules(t.ctx, [
    { key: 'ns_regulator', trigger: 'is_cyber_incident', party: 'Example regulator', hours: 72, required: true, active: true, guidance: 'Invented.' },
  ]);
});
afterAll(async () => { await t.close(); });

const step = async (id: string) => (await t.api.get(`/api/security-incidents/${id}/next-step`)).body;
const advance = (id: string, to?: string) => t.api.post(`/api/security-incidents/${id}/advance`, to ? { to } : {});

describe('next stage', () => {
  it('walks the lifecycle one status at a time, with the checks each stage needs', async () => {
    const created = await t.api.post('/api/security-incidents', { title: 'Next-stage test: invented phishing wave', severity: 'moderate' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    let s = await step(id);
    expect(s.current.value).toBe('reported');
    expect(s.next).toMatchObject({ value: 'declared', action: 'Declare incident' });
    // Declaring before the Affected questions are answered is allowed, with a warning.
    expect(s.checks.find((c: any) => c.key === 'answers')).toMatchObject({ ok: false, blocking: false, tab: 'affected' });
    expect(s.ready).toBe(true);

    expect((await advance(id)).status).toBe(200);
    s = await step(id);
    expect(s.next).toMatchObject({ value: 'contained', action: 'Mark contained' });
    expect(s.checks.find((c: any) => c.key === 'lead')).toMatchObject({ ok: false, blocking: false });

    const moved = await advance(id, 'contained');
    expect(moved.status).toBe(200);
    expect(moved.body.incident.status).toBe('contained');
    expect(moved.body.incident.contained_at).toBeTruthy();
    expect(moved.body.step.next).toMatchObject({ value: 'recovering', action: 'Mark recovering' });

    // A page that has fallen behind does not move the incident twice.
    expect((await advance(id, 'contained')).body.error.code).toBe('stale');
    expect((await advance(id, 'recovering')).status).toBe(200);

    // Closing needs the Affected answers, every required notification made, and no open ransom decision.
    s = await step(id);
    expect(s.next).toMatchObject({ value: 'closed', action: 'Close incident' });
    expect(s.ready).toBe(false);
    let refused = await advance(id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('checks');
    expect(refused.body.error.message).toContain('affected questions answered');

    expect((await t.api.patch(`/api/security-incidents/${id}`, { is_cyber_incident: true, personal_info_involved: false })).status).toBe(200);
    s = await step(id);
    expect(s.checks.find((c: any) => c.key === 'answers').ok).toBe(true);
    expect(s.checks.find((c: any) => c.key === 'notifications')).toMatchObject({ ok: false, blocking: true });
    refused = await advance(id);
    expect(refused.body.error.message).toContain('required notifications made');

    const tasks = (await t.api.get(`/api/notification-tasks?f.incident_id=${id}`)).body.rows as any[];
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      const done = await t.api.patch(`/api/notification-tasks/${task.id}`, {
        status: 'done', notified_who: 'Duty officer', notified_how: 'Portal', notified_at: new Date().toISOString(),
      });
      expect(done.status).toBe(200);
    }
    expect((await step(id)).ready).toBe(true);
    const closed = await advance(id);
    expect(closed.status).toBe(200);
    expect(closed.body.incident.status).toBe('closed');
    expect(closed.body.step.next).toBeNull();
    expect((await advance(id)).body.error.code).toBe('no_next_step');
  });

  it('needs the security permissions', async () => {
    const created = await t.api.post('/api/security-incidents', { title: 'Next-stage test: invented lost tablet' });
    const agent = await t.as('agent');
    expect((await agent.get(`/api/security-incidents/${created.body.id}/next-step`)).status).toBe(403);
    expect((await agent.post(`/api/security-incidents/${created.body.id}/advance`, {})).status).toBe(403);
  });
});
