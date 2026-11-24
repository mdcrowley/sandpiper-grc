import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveAuditEvents, OWNER_GRACE_DAYS, SETTING_AUDIT_ARCHIVE } from '../core/audit-archive.ts';
import { testApp } from '../test/helpers.ts';
import { archiveAsOwner } from './audit-archive-owner.ts';
import { grantRuntimeRole } from './db-roles.ts';
import { OpsError } from './errors.ts';

// E40-14: with a least-privilege run-time role the server may not delete audit events, so the
// archive runs as the database owner (`audit-archive`). The run-time role is taken with
// `set local role` inside `db.trial`, as in db-roles-runtime.test.ts, so this runs the same on the
// embedded database, over the wire protocol and on a PostgreSQL server.

let t: Awaited<ReturnType<typeof testApp>>;
const role = `grc_rt_${randomBytes(4).toString('hex')}`;
const scratch = mkdtempSync(join(tmpdir(), 'grc-owner-archive-'));

beforeAll(async () => {
  t = await testApp();
  await t.db.exec(`create role ${role} nologin`);
  await grantRuntimeRole(t.db, role);
});
afterAll(async () => {
  await t.db.exec(`drop owned by ${role}; drop role ${role}`).catch(() => {});
  await t.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function asRuntimeRole<T>(fn: () => Promise<T>): Promise<T> {
  return t.db.trial!(async () => {
    await t.db.exec(`set local role ${role}`);
    return fn();
  });
}

const insertOld = (sql: string) => t.db.query(
  `insert into audit_events (at, action, summary, actor_name) select ${sql} + make_interval(secs => g), 'test.old', 'Invented old event ' || g, 'Invented Person'
   from generate_series(1, 25) g`);

describe('the audit archive under a least-privilege role (E40-14)', () => {
  it('refuses while the archive is off', async () => {
    await expect(archiveAsOwner(t.db, { dataDir: 'memory' })).rejects.toThrow(OpsError);
  });

  it('the run-time role cannot archive; the job only warns once events wait past the grace period', async () => {
    await t.ctx.settings.set(SETTING_AUDIT_ARCHIVE, { enabled: true, olderThanMonths: 12, folder: scratch });
    // Just past the cut-off: the owner's next scheduled run will take them, nobody is told.
    await insertOld(`now() - interval '12 months' - interval '5 days'`);
    const recent = await asRuntimeRole(() => archiveAuditEvents(t.ctx));
    expect(recent).toMatchObject({ status: 'not_permitted', overdue: false });
    expect(recent.message).toMatch(/audit-archive/);
    // Long past it: the owner's runs have stopped.
    await insertOld(`now() - interval '12 months' - interval '${OWNER_GRACE_DAYS + 10} days'`);
    const late = await asRuntimeRole(() => archiveAuditEvents(t.ctx));
    expect(late).toMatchObject({ status: 'not_permitted', overdue: true });
    expect(readdirSync(scratch)).toEqual([]);
    // And the run-time role really may not delete audit events, trigger or not.
    await expect(asRuntimeRole(() => t.db.query(`delete from audit_events where action = 'test.old'`))).rejects.toThrow(/permission denied/);
  });

  it('the owner command archives them, checked and audited, naming the account', async () => {
    const result = await archiveAsOwner(t.db, { dataDir: 'memory' });
    expect(result).toMatchObject({ status: 'archived', count: 50 });
    expect(readdirSync(scratch).length).toBe(2);
    expect((await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where action = 'test.old'`))!.n).toBe(0);
    const event = await t.db.one<{ summary: string; after: any }>(`select summary, after from audit_events where action = 'audit.archive' order by id desc limit 1`);
    expect(event!.summary).toMatch(new RegExp(`removed by the owner command \\(database account ${result.account}\\)$`));
    expect(event!.after.by).toContain(result.account);
    // A second run finds nothing.
    expect((await archiveAsOwner(t.db, { dataDir: 'memory' })).status).toBe('nothing');
    // The job, as the run-time role, has nothing overdue now.
    expect((await asRuntimeRole(() => archiveAuditEvents(t.ctx))).status).toBe('nothing');
  });

  it('a folder for this run must be a full path', async () => {
    await expect(archiveAsOwner(t.db, { dataDir: 'memory', folder: 'relative/dir' })).rejects.toThrow(/full path/);
  });
});
