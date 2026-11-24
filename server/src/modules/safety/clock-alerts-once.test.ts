import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E40-12: a safety reporting-deadline alert is marked sent only once it has been sent. An alert whose
// sending fails is not lost: the next sweep sends it. Everything is invented.
let t: Awaited<ReturnType<typeof testApp>>;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('safety clock alerts', () => {
  it('are sent by the next sweep when sending failed, and then once only', async () => {
    await t.api.post('/api/safety/report-rules', {
      name: 'Invented retry rule', party: 'Invented retry body', deadline_hours: 4, active: true,
      conditions: [{ field: 'damage_estimate', op: 'gte', value: 80000 }],
    });
    const event = (await t.api.post('/api/safety-events', {
      title: 'Invented retry event', occurred_at: hoursAgo(0.1), event_type: 'collision', severity: 'major', damage_estimate: 85000,
    })).body;
    expect(event.reportable).toBe(true);
    await t.db.query(`update safety_events set occurred_at = now() - interval '5 hours' where id = $1`, [event.id]);
    await t.db.query(`update safety_notifications set due_at = now() - interval '1 hour' where event_id = $1`, [event.id]);

    // The audit write fails once while the red alert is being sent.
    const audit = t.ctx.audit;
    let failOnce = true;
    t.ctx.audit = async (req, ev) => {
      if (failOnce && ev.action === 'safety_notification.alert_red') { failOnce = false; throw new Error('invented failure'); }
      return audit(req, ev);
    };
    const saved = console.error;
    console.error = () => undefined;
    try {
      const failed = await t.api.post('/api/safety/clocks/sweep');
      expect(failed.status).toBe(500);
    } finally {
      console.error = saved;
      t.ctx.audit = audit;
    }
    // Not marked sent: the stamp was taken back.
    expect((await t.db.one<any>('select alerted_red_at from safety_notifications where event_id = $1', [event.id])).alerted_red_at).toBeNull();

    // The next sweep sends it, and the one after sends nothing.
    expect((await t.api.post('/api/safety/clocks/sweep')).body).toMatchObject({ red: 1 });
    expect((await t.db.one<any>('select alerted_red_at from safety_notifications where event_id = $1', [event.id])).alerted_red_at).not.toBeNull();
    expect((await t.api.post('/api/safety/clocks/sweep')).body).toEqual({ amber: 0, red: 0 });
    const sent = await t.db.query(`select 1 from audit_events where action = 'safety_notification.alert_red' and record_id = $1`, [event.id]);
    expect(sent).toHaveLength(1);
  });

  it('are checked every five minutes', async () => {
    expect((await t.db.one<any>(`select every_seconds from job_schedules where name = 'safety.clocks'`)).every_seconds).toBe(300);
  });
});
