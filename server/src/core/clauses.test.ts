import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from './module.ts';
import { checksOf, clauseSet, clauseSets, defineClauseSet, getChecklist, saveChecklist } from './clauses.ts';
import { testApp } from '../test/helpers.ts';

// The clause-checklist engine (wave 11 contract C4): one table and one set of rules for every
// clause checklist, with a stand-in scope type so the engine is tested on its own.
const standIn: ModuleDef = {
  key: 'clausestandin',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists t_deals (
      id uuid primary key default gen_random_uuid(), ref text, title text not null,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
    await ctx.lookups.ensure('t_clause', [
      { value: 'one', label: 'Clause one', sort: 10, meta: { description: 'The first clause.' } },
      { value: 'two', label: 'Clause two', sort: 20 },
    ]);
    await ctx.lookups.ensure('t_clause_status', [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 't_deal', table: 't_deals', module: 'contracts', label: 'Deal', plural: 'Deals', path: '/api/t-deals', route: '/t-deals',
      titleField: 'title', ref: { field: 'ref', prefix: 'DL-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true } },
    });
    defineClauseSet(ctx.app, {
      key: 't_terms', label: 'Test terms', list: 't_clause', statusList: 't_clause_status', scopeType: 't_deal', subKey: 'award',
      permission: 'contracts.view', auditAction: 't_deal.clause',
      describe: ({ clause, status, scope, subKey }) => `"${clause}" ${status ?? 'cleared'} on ${scope?.ref}${subKey ? ` for ${subKey}` : ''}`,
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;
beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors';
  t = await testApp({ extraModules: [standIn] });
});
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

describe('clause sets', () => {
  it('refuses a malformed or duplicate set', () => {
    const base = { label: 'X', list: 'l', statusList: 's', scopeType: 't_deal', permission: 'contracts.view', auditAction: 'x', describe: () => '' };
    expect(() => defineClauseSet(t.app, { ...base, key: 'Bad Key' })).toThrow();
    expect(() => defineClauseSet(t.app, { ...base, key: 't_terms' })).toThrow(/twice/);
    expect(() => defineClauseSet(t.app, { ...base, key: 'ok_key', permission: 'nope' })).toThrow();
    expect(clauseSet(t.app, 't_terms')?.label).toBe('Test terms');
    // The vendors module puts the contract security terms on the engine.
    expect(clauseSets(t.app).map((s) => s.key)).toEqual(expect.arrayContaining(['security_terms', 't_terms']));
  });
});

describe('checklists', () => {
  it('lists every clause, saves per sub-key, validates and audits each change once', async () => {
    const deal = await t.ctx.resources.create('t_deal', { title: 'Deal' });
    const empty = await getChecklist(t.ctx, 't_terms', deal.id, 'A');
    expect(empty.map((c) => [c.clause_key, c.status, c.description])).toEqual([['one', null, 'The first clause.'], ['two', null, null]]);

    await expect(saveChecklist(t.ctx, 't_terms', deal.id, 'A', [{ clause_key: 'nope', status: 'yes' }], null)).rejects.toMatchObject({ status: 400 });
    await expect(saveChecklist(t.ctx, 't_terms', deal.id, 'A', [{ clause_key: 'one', status: 'maybe' }], null)).rejects.toMatchObject({ status: 400 });

    const saved = await saveChecklist(t.ctx, 't_terms', deal.id, 'A', [{ clause_key: 'one', status: 'yes', clause_text: ' Found in section 4 ' }, { clause_key: 'two', note: 'Ask' }], null);
    expect(saved.changed).toBe(2);
    expect(saved.checklist.find((c) => c.clause_key === 'one')).toMatchObject({ status: 'yes', clause_text: 'Found in section 4' });
    // The other sub-key is a checklist of its own.
    expect((await getChecklist(t.ctx, 't_terms', deal.id, 'B')).every((c) => c.status === null)).toBe(true);
    // Saving the same again changes nothing; a field left out keeps its value.
    expect((await saveChecklist(t.ctx, 't_terms', deal.id, 'A', [{ clause_key: 'one', status: 'yes' }], null)).changed).toBe(0);
    await saveChecklist(t.ctx, 't_terms', deal.id, 'A', [{ clause_key: 'one', status: 'no' }], null);
    const one = (await getChecklist(t.ctx, 't_terms', deal.id, 'A')).find((c) => c.clause_key === 'one')!;
    expect(one).toMatchObject({ status: 'no', clause_text: 'Found in section 4' });

    const events = await t.db.query<Row>(`select summary from audit_events where action = 't_deal.clause' and record_id = $1 order by id`, [deal.id]);
    expect(events.map((e) => e.summary)).toEqual([`"Clause one" yes on ${deal.ref} for A`, `"Clause two" cleared on ${deal.ref} for A`, `"Clause one" no on ${deal.ref} for A`]);
    const rows = await checksOf(t.db, 't_terms', { scopeIds: [deal.id] });
    expect(rows).toHaveLength(2);
    expect(await checksOf(t.db, 't_terms', { scopeIds: [deal.id], subKey: 'B' })).toHaveLength(0);
  });
});

describe('the move of the old tables', () => {
  it('copies the contract security terms into the engine and keeps the API shape', async () => {
    const vendor = (await t.api.post('/api/vendors', { name: 'Engine Copy Vendor' })).body;
    const contract = (await t.api.post('/api/contracts', { title: 'Old checks', vendor_id: vendor.id })).body;
    await t.db.query(`insert into contract_clause_checks (contract_id, clause_key, status, clause_text) values ($1, 'mfa', 'partial', 'Admins only')`, [contract.id]);
    const sql = readFileSync(join(import.meta.dirname, '../modules/vendors/migrations/005_vendor_lifecycle.sql'), 'utf8');
    await t.db.exec(sql.slice(sql.indexOf('insert into clause_checks')));
    const list = (await t.api.get(`/api/contracts/${contract.id}/clauses`)).body;
    expect(list.find((c: Row) => c.clause_key === 'mfa')).toMatchObject({ status: 'partial', clause_text: 'Admins only' });
    // Running the copy again changes nothing.
    await t.db.exec(sql.slice(sql.indexOf('insert into clause_checks')));
    expect(await checksOf(t.db, 'security_terms', { scopeIds: [contract.id] })).toHaveLength(1);
  });
});
