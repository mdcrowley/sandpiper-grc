import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { sweepClocks } from './alerts.ts';
import { loadOrganizationRules } from './defaults.ts';

// E22-42: a clock alert is claimed in one statement before it is sent, so two sweeps that overlap
// (the minute job and a change to the incident, or two server processes) send it once.
// Invented data only. Runs alone (GRC_MODULES=secincidents) and with every module.

const HOUR = 3_600_000;
let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  t = await testApp();
  await loadOrganizationRules(t.ctx, [
    { key: 'claim_party', trigger: 'is_cyber_incident', party: 'Invented Claim Party', hours: 24, required: true, active: true, guidance: 'Invented.' },
  ]);
});
afterAll(async () => { await t.close(); });

async function declare(hoursAgo: number) {
  const res = await t.api.post('/api/security-incidents', {
    title: 'Claim test: invented timetable feed outage', severity: 'high', status: 'declared',
    discovered_at: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
  });
  expect(res.status).toBe(201);
  return res.body;
}

const alertsIn = async (id: string) => (await t.db.query<any>(
  `select entry from incident_log_entries where incident_id = $1 and entry like 'Alert:%'`, [id])).length;
const audits = async (level: string, id: string) => (await t.db.query<any>(
  `select 1 from audit_events e join notification_tasks n on n.id::text = e.record_id::text
   where e.action = $1 and n.incident_id = $2`, [`notification_task.alert_${level}`, id])).length;

describe('clock alerts are claimed before they are sent (E22-42)', () => {
  it('sends the amber alert once when two sweeps overlap', async () => {
    const incident = await declare(1); // green at declaration: no alert yet
    expect(await alertsIn(incident.id)).toBe(0);
    await t.db.query(`update notification_tasks set due_at = now() + interval '1 hour' where incident_id = $1`, [incident.id]);
    const logs: string[] = [];
    const addLog = async (_id: string, entry: string) => { logs.push(entry); };
    const [a, b] = await Promise.all([sweepClocks(t.ctx, addLog, incident.id), sweepClocks(t.ctx, addLog, incident.id)]);
    expect(a.amber + b.amber).toBe(1);
    expect(logs.length).toBe(1);
    expect(await audits('amber', incident.id)).toBe(1);
  });

  it('sends the red alert once when two sweeps overlap', async () => {
    const incident = await declare(1);
    await t.db.query(`update notification_tasks set due_at = now() - interval '5 minutes' where incident_id = $1`, [incident.id]);
    const logs: string[] = [];
    const addLog = async (_id: string, entry: string) => { logs.push(entry); };
    const runs = await Promise.all([1, 2, 3].map(() => sweepClocks(t.ctx, addLog, incident.id)));
    expect(runs.reduce((s, r) => s + r.red, 0)).toBe(1);
    expect(runs.reduce((s, r) => s + r.amber, 0)).toBe(0);
    expect(logs.filter((l) => l.includes('has passed')).length).toBe(1);
    expect(await audits('red', incident.id)).toBe(1);
    // And a later sweep finds nothing more to send.
    expect(await sweepClocks(t.ctx, addLog, incident.id)).toEqual({ amber: 0, red: 0 });
  });
});
