import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { FAKE_MALWARE_MARKER, startFakeClamd, startFakeS3, type FakeClamd, type FakeS3 } from './fakes.ts';

// File housekeeping, rescans and moves as background jobs (E14-27). Invented records only.
const fixtures: ModuleDef = {
  key: 'testfiles_bg',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_bg_depots (
      id uuid primary key default gen_random_uuid(), name text not null,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'bg_depot', table: 'test_bg_depots', module: 'tickets', label: 'Depot', plural: 'Depots',
      path: '/api/bg-depots', route: '/bg-depots', titleField: 'name',
      fields: { name: { label: 'Name', type: 'text', required: true } },
    });
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async () => ({ sent: 1, skipped: 0 }));
  },
};

const CRED = { accessKeyId: 'AKIDTESTONLY', secretAccessKey: 'invented-secret-for-tests-only', region: 'test-region-1', bucket: 'grc-files' };
let t: Awaited<ReturnType<typeof testApp>>;
let token: string;
let depot: string;
let clamd: FakeClamd;
let s3: FakeS3;

async function upload(name: string, data: string) {
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'bg_depot', record_id: depot, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
    payload: Buffer.from(data),
  });
  return res.json();
}

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  token = await createSession(t.db, admin!.id);
  expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
  depot = (await t.api.post('/api/bg-depots', { name: 'East depot' })).body.id;
  clamd = await startFakeClamd();
  s3 = await startFakeS3(CRED);
});
afterAll(async () => {
  await clamd.close();
  await s3.close();
  await t.close();
});

describe('scheduled file work', () => {
  it('runs the daily purge and the backup check as job-queue schedules', async () => {
    const rows = await t.db.query<{ name: string; every_seconds: number }>(
      `select name, every_seconds from job_schedules where name in ('attachments.housekeeping', 'backups.schedule') order by name`);
    expect(rows).toEqual([{ name: 'attachments.housekeeping', every_seconds: 86400 }, { name: 'backups.schedule', every_seconds: 300 }]);
    const ran = await t.api.post('/api/admin/jobs/schedules/attachments.housekeeping/run');
    expect(ran.body).toMatchObject({ status: 'done', result: { orphans: 0, purged: 0, failed: 0 } });
    const backup = await t.api.post('/api/admin/jobs/schedules/backups.schedule/run');
    expect(backup.body).toMatchObject({ status: 'done', result: 'off' });
  });
});

describe('scanning earlier files in the background', () => {
  it('needs scanning switched on, runs as a job with progress, one at a time', async () => {
    const good = await upload('earlier-good.txt', 'Route 9 timetable');
    const bad = await upload('earlier-bad.txt', `old ${FAKE_MALWARE_MARKER}`);
    expect(good.scan_status).toBe('not_scanned');
    expect((await t.api.post('/api/attachments/admin/rescan/start')).body.error.code).toBe('no_scanner');

    await t.api.patch('/api/attachments/admin/scanner', { enabled: true, port: clamd.port, timeoutSeconds: 5 });
    const before = (await t.api.get('/api/attachments/admin/background')).body;
    expect(before).toMatchObject({ rescan: null, move: null, notScanned: 2, scanning: true });

    const started = await t.api.post('/api/attachments/admin/rescan/start');
    expect(started.status).toBe(200);
    expect(started.body.rescan).toMatchObject({ status: 'queued' });
    expect((await t.api.post('/api/attachments/admin/rescan/start')).body.error.code).toBe('already_running');

    await t.app.jobs.runDue({ types: ['attachments.rescan'] });
    const after = (await t.api.get('/api/attachments/admin/background')).body;
    expect(after.rescan).toMatchObject({ status: 'done', progress: { total: 2, checked: 2, clean: 1, infected: 1, errors: 0, remaining: 0 } });
    expect(after.notScanned).toBe(0);
    expect((await t.db.one<any>('select scan_status from attachments where id = $1', [bad.id])).scan_status).toBe('infected');
    expect((await t.db.query(`select 1 from audit_events where action = 'attachment.rescan_start'`)).length).toBe(1);
    await t.api.patch('/api/attachments/admin/scanner', { enabled: false });
  });

  it('is for administrators only', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/attachments/admin/background')).status).toBe(403);
    expect((await agent.post('/api/attachments/admin/rescan/start')).status).toBe(403);
  });
});

describe('moving files in the background', () => {
  it('moves every file to the object store and back while the application keeps running', async () => {
    await upload('to-move.txt', 'kept on disk first');
    expect((await t.api.post('/api/attachments/admin/storage/move', { to: 'elsewhere' })).status).toBe(400);
    const s3Settings = {
      driver: 's3', s3: { endpoint: s3.endpoint, region: CRED.region, bucket: CRED.bucket, pathStyle: true, prefix: 'files', accessKeyId: CRED.accessKeyId, secretAccessKey: CRED.secretAccessKey },
    };
    expect((await t.api.patch('/api/attachments/admin/storage', s3Settings)).status).toBe(200);

    const started = await t.api.post('/api/attachments/admin/storage/move', { to: 's3' });
    expect(started.status).toBe(200);
    expect(started.body.move).toMatchObject({ status: 'queued', to: 's3' });
    await t.app.jobs.runDue({ types: ['attachments.move'] });
    const done = (await t.api.get('/api/attachments/admin/background')).body.move;
    expect(done).toMatchObject({ status: 'done', to: 's3', progress: { to: 's3', failed: 0 } });
    expect(done.progress.moved).toBeGreaterThanOrEqual(2);
    expect((await t.db.query(`select 1 from attachments where purged_at is null and storage_driver <> 's3'`)).length).toBe(0);

    await t.api.patch('/api/attachments/admin/storage', { driver: 'disk' });
    await t.api.post('/api/attachments/admin/storage/move', { to: 'disk' });
    await t.app.jobs.runDue({ types: ['attachments.move'] });
    expect((await t.api.get('/api/attachments/admin/background')).body.move).toMatchObject({ status: 'done', to: 'disk' });
    expect((await t.db.query(`select 1 from attachments where purged_at is null and storage_driver = 's3'`)).length).toBe(0);
    expect((await t.db.query(`select 1 from audit_events where action = 'attachment.move_start'`)).length).toBe(2);
  });

  it('needs a recent password confirmation', async () => {
    const other = await t.as('administrator');
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day' where user_id = $1`, [other.userId]);
    expect((await other.post('/api/attachments/admin/storage/move', { to: 'disk' })).body.error.code).toBe('reauth_required');
  });
});
