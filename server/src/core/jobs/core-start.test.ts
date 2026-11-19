import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E14-23: core starts the job queue and email itself, so they exist whichever modules are
// loaded (run with GRC_MODULES=none), and core's own recurring work (webhook deliveries and
// the retention sweep, E14-22) is on the queue.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('core services', () => {
  it('offers background jobs and email with or without the notifications module', async () => {
    expect(t.app.hasDecorator('jobs')).toBe(true);
    expect(t.app.hasDecorator('sendMail')).toBe(true);
    expect((await t.api.get('/api/admin/jobs')).status).toBe(200);
    expect((await t.api.get('/api/admin/mail/settings')).status).toBe(200);
  });

  it('runs webhook deliveries and the retention sweep as job-queue schedules', async () => {
    const names = (await t.db.query<{ name: string }>(`select name from job_schedules where name like 'core.%' order by name`)).map((r) => r.name);
    expect(names).toEqual(['core.retention_sweep', 'core.webhook_deliveries']);
    expect((await t.api.post('/api/admin/jobs/schedules/core.retention_sweep/run')).body).toMatchObject({ status: 'done' });
    expect((await t.api.post('/api/admin/jobs/schedules/core.webhook_deliveries/run')).body).toMatchObject({ status: 'done' });
  });
});
