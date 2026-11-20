import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gizmos } from '../core/export/testing.ts';
import { testApp } from '../test/helpers.ts';
import { addCustomColumns, grantRuntimeRole, pendingSchemaRequests } from './db-roles.ts';

// E16-37: with a least-privilege run-time role the server never changes the schema. Custom fields
// need no schema change (the owner gives every record table its column up front), and a search
// definition that changed is recorded for the owner's migrate step instead of rebuilt.
//
// The run-time role is taken with `set local role` inside `db.trial` (core/db.ts), which sends all
// of the application's queries, requests included, through that one transaction: so the test runs
// the same on the embedded database, over the wire protocol (GRC_TEST_DATABASE=pg) and on a
// PostgreSQL server (GRC_TEST_DATABASE_URL). Everything done inside is rolled back.

let t: Awaited<ReturnType<typeof testApp>>;
const role = `grc_rt_${randomBytes(4).toString('hex')}`;
const DDL = /^\s*(create|alter|drop|comment)\b|create\s+(or\s+replace\s+)?(function|trigger)|\bdrop\s+trigger\b/i;

beforeAll(async () => {
  t = await testApp({ extraModules: [gizmos] });
  await t.db.exec(`create role ${role} nologin`);
});
afterAll(async () => {
  await t.db.exec(`drop owned by ${role}; drop role ${role}`).catch(() => {});
  await t.close();
});

/** Runs `fn` as the run-time role, collecting every schema-changing statement the application sends. */
async function asRuntimeRole<T>(fn: (ddl: string[]) => Promise<T>): Promise<T> {
  const ddl: string[] = [];
  const db = t.db as unknown as Record<'exec' | 'query' | 'one', (sql: string, params?: unknown[]) => Promise<unknown>>;
  const saved = { exec: db.exec, query: db.query, one: db.one };
  for (const k of ['exec', 'query', 'one'] as const) {
    db[k] = (sql: string, params?: unknown[]) => { if (DDL.test(sql)) ddl.push(sql.trim().slice(0, 120)); return saved[k](sql, params); };
  }
  try {
    return await t.db.trial!(async () => {
      await saved.exec(`set local role ${role}`);
      return fn(ddl);
    });
  } finally {
    Object.assign(db, saved);
  }
}

describe('schema changes at run time without the owner account (E16-37)', () => {
  it('the owner gives every record table its custom-field column, skipping views and tables that have one', async () => {
    const tables = t.core.resources.registry.all().map((d) => d.table);
    const added = await addCustomColumns(t.db, tables);
    expect(added).toContain('test_gizmos');
    expect(await addCustomColumns(t.db, tables)).toEqual([]);
    await grantRuntimeRole(t.db, role);
  });

  it('a custom field is defined and filled by the run-time role with no schema change', async () => {
    const result = await asRuntimeRole(async (ddl) => {
      expect((await t.db.one<{ u: string }>('select current_user as u'))!.u).toBe(role);
      const field = await t.api.post('/api/admin/custom-fields', { record_type: 'gizmo', label: 'Depot code', type: 'text' });
      const made = await t.api.post('/api/gizmos', { name: 'Ticket validator', cf_depot_code: 'North yard' });
      const found = await t.api.get('/api/gizmos?q=validator');
      return { field: field.status, made: made.body.cf_depot_code, found: found.body.total, ddl, pending: await pendingSchemaRequests(t.db) };
    });
    expect(result.field).toBe(201);
    expect(result.made).toBe('North yard');
    // The new text field changes the search definition: recorded for the owner, not attempted;
    // search keeps working on the earlier trigger meanwhile.
    expect(result.ddl).toEqual([]);
    expect(result.pending).toEqual([expect.objectContaining({ kind: 'search', target: 'gizmo' })]);
    expect(result.found).toBe(1);
  });

  it('a record table without the column is refused with the reason, and recorded', async () => {
    await t.db.exec('alter table test_vaults drop column if exists custom');
    const result = await asRuntimeRole(async (ddl) => {
      const res = await t.api.post('/api/admin/custom-fields', { record_type: 'vault', label: 'Shelf', type: 'text' });
      return { status: res.status, ddl, pending: await pendingSchemaRequests(t.db) };
    });
    expect(result.status).toBe(400);
    expect(result.ddl).toEqual([]);
    expect(result.pending).toEqual([expect.objectContaining({ kind: 'custom_column', target: 'vault' })]);
  });

  it('as the owner the same changes are made and leave nothing waiting', async () => {
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'gizmo', label: 'Depot code', type: 'text' })).status).toBe(201);
    await t.api.post('/api/gizmos', { name: 'Platform screen', cf_depot_code: 'Riverside' });
    expect((await t.api.get('/api/gizmos?q=Riverside')).body.total).toBe(1);
    expect(await pendingSchemaRequests(t.db)).toEqual([]);
  });
});
