import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { parseSearch } from './search.ts';
import { testApp } from '../test/helpers.ts';

// E16-41: the full-text list and global search read the matching rows of the search index joined
// to the records, rather than reading record tables in full. These tests pin that the results are
// those of the earlier statements: the same records, in the same order, with the same ranks and
// totals, for people who may and may not see restricted records, for one word and for several, for
// matches by words, by part of a word, by title, by reference, and for a type whose title is not
// one of its substring fields (searched as before). The earlier statements are written out here.

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let agent: Awaited<ReturnType<T['as']>>; // no security.view: restricted records hidden
const env = process.env.GRC_MODULES;

const fixtures: ModuleDef = {
  key: 'searchresults',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists sr_items (
        id uuid primary key default gen_random_uuid(), ref text, name text not null, notes text,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists sr_logs (
        id uuid primary key default gen_random_uuid(), ref text, name text not null, notes text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'sritem', table: 'sr_items', module: 'tickets', label: 'Item', plural: 'Items',
      path: '/api/sr-items', route: '/sr-items', titleField: 'name', ref: { field: 'ref', prefix: 'SRI-' },
      restricted: 'flag', searchable: ['name', 'notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    // The title is not a substring field: several words are still matched on it by reading the table.
    ctx.defineResource({
      type: 'srlog', table: 'sr_logs', module: 'tickets', label: 'Log', plural: 'Logs',
      path: '/api/sr-logs', route: '/sr-logs', titleField: 'name', ref: { field: 'ref', prefix: 'SRL-' },
      searchable: ['notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
      },
    });
  },
};

const WORDS = ['depot', 'alarm', 'panel', 'brake', 'door', 'signal', 'shelter', 'printer', 'radio', 'fare', 'gate', 'pump'];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const words = (n: number) => Array.from({ length: n }, () => WORDS[Math.floor(rand() * rand() * WORDS.length)]).join(' ');

beforeAll(async () => {
  process.env.GRC_MODULES = 'none-of-the-modules';
  t = await testApp({ extraModules: [fixtures] });
  agent = await t.as('agent');
  for (let i = 0; i < 70; i++) {
    const name = i % 9 === 0 ? `Depot alarmpanel fault ${i}` : `${words(3)} ${i}`;
    const notes = i % 7 === 0 ? `Seen near the depot alarm and the tunnel siren, ${words(4)}.` : `${words(8)}.`;
    const made = await t.api.post('/api/sr-items', { name, notes, restricted: i % 5 === 0 });
    expect(made.status).toBeLessThan(300);
    await t.api.post('/api/sr-logs', { name: i % 4 === 0 ? `Depot alarmpanel log ${i}` : `${words(2)} log ${i}`, notes: `${words(6)}.` });
  }
  // A deleted record is never found.
  const gone = (await t.api.post('/api/sr-items', { name: 'Depot alarmpanel removed', notes: 'depot alarm' })).body;
  expect((await t.api.del(`/api/sr-items/${gone.id}`)).status).toBeLessThan(300);
});
afterAll(async () => {
  await t?.close();
  if (env === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = env;
});

/** The earlier list statement (before E16-41), for a type with a reference: ids in order, and the total. */
async function listBefore(table: string, q: string, seesRestricted: boolean, cols: string[]) {
  const s = parseSearch(q);
  const p: unknown[] = [];
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  const like = add(s.like);
  const tsq = s.tsquery(add);
  const type = add(table === 'sr_items' ? 'sritem' : 'srlog');
  const exact = `lower(ref::text) = lower(${add(s.text)}::text)`;
  const inBody = s.single ? ` or si.body ilike ${like}` : '';
  const matched = `${table}.id in (select si.record_id from search_index si where si.record_type = ${type} and (si.vector @@ ${tsq}${inBody}))`;
  const cond = `(${matched} or ${exact} or ${s.single ? 'false' : `name::text ilike ${like} or ref::text ilike ${like}`})`;
  const rank = `(coalesce((select ts_rank(si.vector, ${tsq}) from search_index si where si.record_type = ${type} and si.record_id = ${table}.id), 0)`
    + ` + case when ${exact} then 10 else 0 end + case when name::text ilike ${like} then 0.5 else 0 end)`;
  const vis = seesRestricted || !cols.includes('restricted') ? 'true' : 'coalesce(restricted, false) = false';
  const rows = await t.db.query<{ id: string }>(
    `select id from ${table} where deleted_at is null and ${vis} and ${cond} order by ${rank} desc, created_at desc nulls last, id`, p);
  return rows.map((r) => r.id);
}

/** The earlier global search statement for one type (its best six): ids and ranks in order. */
async function globalBefore(table: string, typeKey: string, q: string, seesRestricted: boolean, hasRestricted: boolean) {
  const s = parseSearch(q);
  const p: unknown[] = [];
  const add = (v: unknown) => { p.push(v); return `$${p.length}`; };
  const tsq = s.tsquery(add);
  const like = add(s.like);
  const text = add(s.text);
  const type = add(typeKey);
  const vis = `t.deleted_at is null and ${seesRestricted || !hasRestricted ? 'true' : 'coalesce(t.restricted, false) = false'}`;
  const exact = `lower(t.ref::text) = lower(${text}::text)`;
  const m = `(select si.record_id as id, ts_rank(si.vector, ${tsq}) as r from search_index si
              where si.record_type = ${type} and (si.vector @@ ${tsq}${s.single ? ` or si.body ilike ${like}` : ''})) m`;
  const from = s.single
    ? `${m} join ${table} t on t.id = m.id where ${vis}`
    : `${table} t left join ${m} on m.id = t.id where ${vis} and (m.id is not null or ${exact} or t.name::text ilike ${like} or t.ref::text ilike ${like})`;
  return t.db.query<{ id: string; rank: number }>(
    `select t.id, (coalesce(m.r, 0) + case when ${exact} then 10 else 0 end + case when t.name::text ilike ${like} then 0.5 else 0 end)::float8 as rank
     from ${from} order by rank desc, t.updated_at desc limit 6`, p);
}

const QUERIES = [
  'depot', 'alarm', 'printer', 'panel', 'alarmp', // one word, common and rarer, and part of a word
  'depot alarm', 'alarm depot', 'brake door', // several words
  'pot alarm', // only by title, across words: no word matches
  'nel siren', // the text is in some notes, but neither the words nor the title match: not found
  'zzzq nothing', 'nothing', // no match
];

describe('full-text list: the same records, order and totals as before (E16-41)', () => {
  it('for each query, for people who see restricted records and who do not', async () => {
    const one = (await t.api.get('/api/sr-items?pageSize=1')).body.rows[0];
    for (const q of [...QUERIES, one.ref, one.ref.toLowerCase()]) {
      for (const [api, sees] of [[t.api, true], [agent, false]] as const) {
        for (const [table, path, cols] of [['sr_items', '/api/sr-items', ['restricted']], ['sr_logs', '/api/sr-logs', []]] as const) {
          const expected = await listBefore(table, q, sees, [...cols]);
          const got = (await api.get(`${path}?q=${encodeURIComponent(q)}&pageSize=500`)).body;
          expect(got.rows.map((r: any) => r.id), `${path} q=${q} sees=${sees}`).toEqual(expected);
          expect(got.total).toBe(expected.length);
          // A page past the end still has the exact total.
          if (expected.length) expect((await api.get(`${path}?q=${encodeURIComponent(q)}&pageSize=10&page=99`)).body.total).toBe(expected.length);
        }
      }
    }
    // The cases the queries are meant to cover are really there.
    expect((await listBefore('sr_items', 'pot alarm', true, ['restricted'])).length).toBeGreaterThan(0);
    expect((await listBefore('sr_logs', 'pot alarm', true, [])).length).toBeGreaterThan(0);
    expect((await t.db.query(`select 1 from search_index where record_type = 'sritem' and body ilike '%nel siren%'`)).length).toBeGreaterThan(0);
    expect((await listBefore('sr_items', 'nel siren', true, ['restricted']))).toEqual([]);
  });

  it('keeps an explicit sort, and exports the same rows', async () => {
    const sorted = (await t.api.get('/api/sr-items?q=depot&sort=name&pageSize=500')).body.rows.map((r: any) => r.name);
    expect(sorted.length).toBeGreaterThan(1);
    expect(sorted).toEqual([...sorted].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
    const csv = await t.api.get('/api/sr-items?q=depot%20alarm&format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\r\n').filter((l: string) => !l.includes('Restricted export')).length - 1).toBe((await listBefore('sr_items', 'depot alarm', true, ['restricted'])).length);
  });
});

describe('global search: the same records, order and ranks as before (E16-41)', () => {
  it('for each query, for people who see restricted records and who do not', async () => {
    const one = (await t.api.get('/api/sr-items?pageSize=1')).body.rows[0];
    for (const q of [...QUERIES, one.ref]) {
      for (const [api, sees] of [[t.api, true], [agent, false]] as const) {
        const got = (await api.get(`/api/search?q=${encodeURIComponent(q)}`)).body as any[];
        for (const [table, type, restricted] of [['sr_items', 'sritem', true], ['sr_logs', 'srlog', false]] as const) {
          const expected = await globalBefore(table, type, q, sees, restricted);
          const mine = got.filter((r) => r.type === type);
          expect(mine.map((r) => r.id), `q=${q} type=${type} sees=${sees}`).toEqual(expected.map((r) => r.id));
          mine.forEach((r, i) => expect(r.rank).toBeCloseTo(Number(expected[i].rank), 5));
        }
      }
    }
  });
});
