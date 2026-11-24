import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, testApp } from '../test/helpers.ts';
import { AUDIT_COUNT_CAP } from './routes.ts';
import { archiveAuditEvents, MAX_PER_RUN } from './audit-archive.ts';

// E40-06: the audit log at scale. The Audit page counts at most AUDIT_COUNT_CAP matching events,
// the person filter is indexed, and old events can be archived to a checked file and removed.
let t: Awaited<ReturnType<typeof testApp>>;
const scratch = mkdtempSync(join(tmpdir(), 'grc-audit-archive-'));
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); rmSync(scratch, { recursive: true, force: true }); });

const planOf = async (sql: string, params: unknown[] = []) => {
  const rows = await t.db.tx(async (tx) => {
    await tx.query('set local enable_seqscan = off');
    return tx.query<Record<string, string>>(`explain ${sql}`, params);
  });
  return rows.map((r) => Object.values(r)[0]).join('\n');
};

describe('the Audit page at scale', () => {
  it('counts up to the cap and then says "more than", paging on by hasMore', async () => {
    await t.db.query(
      `insert into audit_events (action, summary) select 'test.bulk', 'Invented bulk event ' || g from generate_series(1, $1::int) g`, [AUDIT_COUNT_CAP + 25]);
    const first = (await t.api.get('/api/audit?action=test.bulk&pageSize=50')).body;
    expect(first).toMatchObject({ total: AUDIT_COUNT_CAP, totalCapped: true, hasMore: true, page: 1, pageSize: 50 });
    expect(first.rows).toHaveLength(50);
    // Pages past the cap still answer.
    const far = (await t.api.get(`/api/audit?action=test.bulk&pageSize=50&page=${AUDIT_COUNT_CAP / 50 + 1}`)).body;
    expect(far.rows).toHaveLength(25);
    expect(far.hasMore).toBe(false);
    // Under the cap the count is exact.
    const few = (await t.api.get('/api/audit?action=test.none')).body;
    expect(few).toMatchObject({ total: 0, totalCapped: false, hasMore: false, rows: [] });
  });

  it('filters by person with an index, and refuses an id that is not one', async () => {
    const me = (await t.db.one<{ id: string }>(`select id from users where username = $1`, [ADMIN.username]))!.id;
    const mine = (await t.api.get(`/api/audit?actor_id=${me}`)).body;
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(mine.rows.every((r: any) => r.actor_id === me)).toBe(true);
    expect((await t.api.get('/api/audit?actor_id=not-a-person')).body.error.code).toBe('bad_filter');
    expect(await planOf(`select * from audit_events where actor_id = $1::uuid order by id desc limit 50`, [me])).toMatch(/audit_events_actor_ix/);
    expect(await planOf(`select * from audit_events where action = $1 order by id desc limit 50`, ['test.bulk'])).toMatch(/audit_events_action_ix/);
  });
});

describe('archiving old audit events', () => {
  it('is off by default and changes need a recent password confirmation', async () => {
    const o = (await t.api.get('/api/audit/archive')).body;
    expect(o.settings).toEqual({ enabled: false, olderThanMonths: 84, folder: '' });
    expect(o.permitted).toBe(true);
    expect((await archiveAuditEvents(t.ctx)).status).toBe('off');
    expect((await t.api.post('/api/audit/archive/run')).body.error.code).toBe('not_enabled');
    await t.db.query('update sessions set confirmed_at = null');
    expect((await t.api.put('/api/audit/archive', { enabled: true, folder: scratch })).status).toBe(403); // no recent confirmation
    expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
    const bad = await t.api.put('/api/audit/archive', { enabled: true, olderThanMonths: 3, folder: 'relative' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['folder', 'olderThanMonths']);
    expect((await (await t.as('agent')).get('/api/audit/archive')).status).toBe(403);
  });

  it('writes old events to a checked file, removes exactly those, and audits it', async () => {
    await t.db.query(
      `insert into audit_events (at, action, summary, actor_name) select now() - interval '10 years' + make_interval(secs => g), 'test.ancient', 'Invented ancient event ' || g, 'Invented Person'
       from generate_series(1, 120) g`);
    const recent = (await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where at > now() - interval '1 year'`))!.n;
    const saved = await t.api.put('/api/audit/archive', { enabled: true, olderThanMonths: 60, folder: scratch });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toEqual({ enabled: true, olderThanMonths: 60, folder: scratch });

    const queued = await t.api.post('/api/audit/archive/run');
    expect(queued.status).toBe(200);
    expect((await t.api.post('/api/audit/archive/run')).body.error.code).toBe('already_queued');
    const job = await t.app.jobs.runNow(queued.body.jobId);
    expect(job).toMatchObject({ status: 'done' });
    expect(job!.result).toMatchObject({ status: 'archived', count: 120, more: false });

    const files = readdirSync(scratch).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^audit-archive-\d{8}-\d{6}\.jsonl\.gz$/);
    expect(files[1]).toBe(`${files[0]}.json`);
    const manifest = JSON.parse(readFileSync(join(scratch, files[1]), 'utf8'));
    expect(manifest).toMatchObject({ kind: 'sandpiper-audit-archive', events: 120, sha256: job!.result.sha256 });
    const lines: any[] = [];
    for await (const line of createInterface({ input: createReadStream(join(scratch, files[0])).pipe(createGunzip()) })) lines.push(JSON.parse(line));
    expect(lines).toHaveLength(120);
    expect(lines[0]).toMatchObject({ action: 'test.ancient', summary: 'Invented ancient event 1' });

    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where action = 'test.ancient'`))!.n).toBe(0);
    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where at > now() - interval '1 year'`))!.n).toBeGreaterThanOrEqual(recent);
    const event = await t.db.one<any>(`select actor_name, summary, after from audit_events where action = 'audit.archive'`);
    expect(event.actor_name).toBe('System');
    expect(event.summary).toMatch(/^120 audit events older than \d{4}-\d{2}-\d{2} archived to .* and removed$/);
    expect(event.after).toMatchObject({ events: 120, removed: 120 });
    // The page lists it.
    expect((await t.api.get('/api/audit/archive')).body.runs[0].summary).toBe(event.summary);
    // Nothing older remains: the next run writes nothing.
    expect((await archiveAuditEvents(t.ctx)).status).toBe('nothing');
    expect(MAX_PER_RUN).toBeGreaterThanOrEqual(100_000);
  });

  it('stays append-only for everything else', async () => {
    await expect(t.db.query(`delete from audit_events where action = 'test.bulk'`)).rejects.toThrow(/append-only/);
    await expect(t.db.query(`update audit_events set summary = 'changed' where action = 'test.bulk'`)).rejects.toThrow(/append-only/);
    // The setting lasts for its own transaction only.
    await t.db.tx(async (tx) => { await tx.query(`select set_config('grc.audit_archive', 'on', true)`); });
    await expect(t.db.query(`delete from audit_events where action = 'test.bulk'`)).rejects.toThrow(/append-only/);
    expect(existsSync(scratch)).toBe(true);
  });
});
