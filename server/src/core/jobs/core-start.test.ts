import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E14-23: core starts the job queue and email itself, so they exist whichever modules are
// loaded (run with GRC_MODULES=none), and core's own recurring work (webhook deliveries and
// the retention sweep, E14-22; removing passed per-token request counts, E16-43) is on the queue.
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
    expect(names).toEqual(['core.audit_archive', 'core.ops_watch', 'core.request_counts', 'core.retention_sweep', 'core.session_cleanup', 'core.webhook_deliveries']);
    expect((await t.api.post('/api/admin/jobs/schedules/core.retention_sweep/run')).body).toMatchObject({ status: 'done' });
    expect((await t.api.post('/api/admin/jobs/schedules/core.webhook_deliveries/run')).body).toMatchObject({ status: 'done' });
    expect((await t.api.post('/api/admin/jobs/schedules/core.request_counts/run')).body).toMatchObject({ status: 'done' });
    // Wave 19 (E40-04, E40-06, E40-07): the archive is off by default and does nothing.
    expect((await t.api.post('/api/admin/jobs/schedules/core.ops_watch/run')).body).toMatchObject({ status: 'done' });
    expect((await t.api.post('/api/admin/jobs/schedules/core.session_cleanup/run')).body).toMatchObject({ status: 'done' });
    expect((await t.api.post('/api/admin/jobs/schedules/core.audit_archive/run')).body).toMatchObject({ status: 'done', result: { status: 'off' } });
  });
});
