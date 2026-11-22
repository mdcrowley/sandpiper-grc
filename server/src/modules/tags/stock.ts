import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { pageOf } from '../../core/api/conventions.ts';
import { TAG_SETTINGS } from '../../../../shared/asset-tags-api.ts';
import type {
  StockMarkRequest, StockRange, StockRangeInput, StockSource, StockValuesPage, StockValueState, TagSeries, TagSeriesInput,
} from '../../../../shared/asset-tags-api.ts';
import { cleanValue, matchFormat, MAX_TAG_VALUE, sequenceValue, valueKey, type CheckScheme, type TagFormat } from '../../../../shared/tag-format.ts';
import { formatFromRow, invalid, namesOf } from './common.ts';

// Tag stock (E37-03): bought or printed ranges of sequential values, lists of values that are not
// sequential, series for printing your own, and void or lost marks. Owned by TAGS-CORE.
//
// A sequence range is stored as a range (never value by value): its values are the prefix, the number
// zero-padded to `digits`, then the check character the range was made with. Overlaps with other stock
// or with attached values are refused, compared by value key.

/** Most values one range or list may hold. */
export const MAX_RANGE_SIZE = 100_000;
const MAX_NOTE = 500;
const MAX_PREFIX = 20;
/** Values named in an overlap or mark refusal. */
const NAMED = 5;

export interface SeqRange {
  id: string; prefix: string; prefixKey: string; digits: number; first: bigint; last: bigint; check: CheckScheme;
}

function seqFromRow(r: Row): SeqRange {
  return {
    id: r.id, prefix: r.prefix ?? '', prefixKey: valueKey(r.prefix ?? ''), digits: Number(r.digits),
    first: BigInt(String(r.first_number)), last: BigInt(String(r.last_number)), check: (r.check_character ?? 'none') as CheckScheme,
  };
}

/** The value of number `n` of a sequence range. */
export function seqValue(r: Pick<SeqRange, 'prefix' | 'digits' | 'check'>, n: bigint): string {
  return sequenceValue(n, { prefix: r.prefix, digits: r.digits, checkCharacter: r.check });
}

/** The length of every value key of a sequence range. */
const keyLength = (r: SeqRange) => r.prefixKey.length + r.digits + (r.check === 'none' ? 0 : 1);

/** The number a value key stands for in a sequence range, or null when the key is not one of its values. */
export function seqNumber(r: SeqRange, key: string): bigint | null {
  if (key.length !== keyLength(r) || !key.startsWith(r.prefixKey)) return null;
  const body = key.slice(r.prefixKey.length, r.prefixKey.length + r.digits);
  if (!/^[0-9]+$/.test(body)) return null;
  const n = BigInt(body);
  if (n < r.first || n > r.last) return null;
  return valueKey(seqValue(r, n)) === key ? n : null;
}

async function sequences(db: Queryable, exceptId?: string): Promise<SeqRange[]> {
  const rows = await db.query<Row>(
    `select id, prefix, digits, first_number::text as first_number, last_number::text as last_number, check_character
     from tag_ranges where kind = 'sequence' and deleted_at is null and ($1::uuid is null or id <> $1::uuid)`, [exceptId ?? null]);
  return rows.map(seqFromRow);
}

/** Where a value key stands in the stock: in a listed value or a sequence range, and any void or lost mark. */
export async function stockStatus(db: Queryable, key: string): Promise<{ inStock: boolean; rangeId: string | null; formatId: string | null; mark: 'void' | 'lost' | null }> {
  const mark = await db.one<{ status: 'void' | 'lost' }>('select status from tag_stock_marks where value_key = $1', [key]);
  const listed = await db.one<{ range_id: string; format_id: string | null }>(
    `select v.range_id, r.format_id from tag_range_values v join tag_ranges r on r.id = v.range_id and r.deleted_at is null where v.value_key = $1`, [key]);
  if (listed) return { inStock: true, rangeId: listed.range_id, formatId: listed.format_id, mark: mark?.status ?? null };
  for (const r of await sequences(db)) {
    if (seqNumber(r, key) !== null) {
      const f = await db.one<{ format_id: string | null }>('select format_id from tag_ranges where id = $1', [r.id]);
      return { inStock: true, rangeId: r.id, formatId: f?.format_id ?? null, mark: mark?.status ?? null };
    }
  }
  return { inStock: false, rangeId: null, formatId: null, mark: mark?.status ?? null };
}

/** The value keys of a new sequence, in order. */
function keysOf(r: SeqRange): string[] {
  const out: string[] = [];
  for (let n = r.first; n <= r.last; n += 1n) out.push(valueKey(seqValue(r, n)));
  return out;
}

/** Keys from `keys` already in stock (listed or in a sequence) or attached; the first few, and how many. */
async function clashes(db: Queryable, keys: string[], shape: SeqRange | null): Promise<{ named: string[]; count: number }> {
  const hit = new Set<string>();
  const keySet = new Set(keys);
  // Listed values and attached values: by key (for a sequence, only keys of its length and prefix can clash).
  const byKeys = async (sql: string) => {
    if (shape) {
      const rows = await db.query<{ value_key: string }>(`${sql} and length(value_key) = $1 and left(value_key, $2) = $3`,
        [keyLength(shape), shape.prefixKey.length, shape.prefixKey]);
      for (const r of rows) if (keySet.has(r.value_key)) hit.add(r.value_key);
    } else {
      for (let i = 0; i < keys.length; i += 5000) {
        const rows = await db.query<{ value_key: string }>(`${sql} and value_key = any($1::text[])`, [keys.slice(i, i + 5000)]);
        for (const r of rows) hit.add(r.value_key);
      }
    }
  };
  await byKeys(`select v.value_key from tag_range_values v join tag_ranges r on r.id = v.range_id and r.deleted_at is null where true`);
  await byKeys(`select value_key from tag_assignments where status = 'active'`);
  const lengths = new Set(keys.map((k) => k.length));
  for (const r of await sequences(db)) {
    if (!lengths.has(keyLength(r))) continue;
    for (const k of keys) if (!hit.has(k) && seqNumber(r, k) !== null) hit.add(k);
  }
  return { named: keys.filter((k) => hit.has(k)).slice(0, NAMED), count: hit.size };
}

function overlapFail(ctx: ModuleContext, c: { named: string[]; count: number }): never {
  const more = c.count > c.named.length ? ` and ${c.count - c.named.length} more` : '';
  return ctx.fail(409, 'overlap', `Some of these values are already in your tag stock or attached to a record: ${c.named.join(', ')}${more}.`);
}

/** Counts of one range's values by state. */
async function rangeCounts(db: Queryable, range: Row): Promise<StockRange['counts'] & { size: number }> {
  const states = await rangeStates(db, range);
  const size = range.kind === 'sequence' ? Number(BigInt(String(range.last_number)) - BigInt(String(range.first_number)) + 1n) : states.listedCount;
  let attached = 0; let voided = 0; let lost = 0;
  for (const s of states.byKey.values()) {
    if (s.state === 'attached') attached += 1;
    else if (s.state === 'void' || s.state === 'replaced') voided += 1;
    else if (s.state === 'lost') lost += 1;
  }
  return { size, attached, void: voided, lost, available: Math.max(0, size - attached - voided - lost) };
}

interface KeyState { state: StockValueState; recordType: string | null; recordId: string | null }

/**
 * The state of each value of a range that is not simply available: attached (active assignment),
 * void or lost (a mark on a value never attached, or the status a value was ended with), replaced.
 */
async function rangeStates(db: Queryable, range: Row): Promise<{ byKey: Map<string, KeyState>; listedCount: number }> {
  let inRange: (key: string) => boolean;
  let listedCount = 0;
  let filterSql: string;
  let params: unknown[];
  if (range.kind === 'sequence') {
    const r = seqFromRow(range);
    inRange = (k) => seqNumber(r, k) !== null;
    filterSql = 'length(value_key) = $1 and left(value_key, $2) = $3';
    params = [keyLength(r), r.prefixKey.length, r.prefixKey];
  } else {
    const keys = new Set((await db.query<{ value_key: string }>('select value_key from tag_range_values where range_id = $1', [range.id])).map((x) => x.value_key));
    listedCount = keys.size;
    inRange = (k) => keys.has(k);
    filterSql = 'value_key in (select value_key from tag_range_values where range_id = $1)';
    params = [range.id];
  }
  const byKey = new Map<string, KeyState>();
  // Newest assignment of each key decides, an active one always wins.
  const assigned = await db.query<{ value_key: string; status: string; record_type: string; record_id: string }>(
    `select distinct on (value_key) value_key, status, record_type, record_id from tag_assignments where ${filterSql}
     order by value_key, (status = 'active') desc, assigned_at desc`, params);
  for (const a of assigned) {
    if (!inRange(a.value_key)) continue;
    const state: StockValueState | null = a.status === 'active' ? 'attached' : a.status === 'ended' ? null : (a.status as StockValueState);
    if (state) byKey.set(a.value_key, { state, recordType: a.record_type, recordId: a.record_id });
  }
  const marks = await db.query<{ value_key: string; status: 'void' | 'lost' }>(`select value_key, status from tag_stock_marks where ${filterSql}`, params);
  for (const m of marks) {
    if (inRange(m.value_key) && byKey.get(m.value_key)?.state !== 'attached') byKey.set(m.value_key, { state: m.status, recordType: null, recordId: null });
  }
  return { byKey, listedCount };
}

async function rangeView(db: Queryable, r: Row, names: Map<string, string>): Promise<StockRange> {
  const counts = await rangeCounts(db, r);
  let firstValue: string; let lastValue: string;
  if (r.kind === 'sequence') {
    const s = seqFromRow(r);
    firstValue = seqValue(s, s.first); lastValue = seqValue(s, s.last);
  } else {
    const ends = await db.one<{ first: string | null; last: string | null }>(
      `select min(value) as first, max(value) as last from tag_range_values where range_id = $1`, [r.id]);
    firstValue = ends?.first ?? ''; lastValue = ends?.last ?? '';
  }
  return {
    id: r.id, kind: r.kind, formatId: r.format_id ?? null, formatName: r.format_name ?? null, firstValue, lastValue, size: counts.size,
    counts: { attached: counts.attached, available: counts.available, void: counts.void, lost: counts.lost },
    source: r.source, seriesId: r.series_id ?? null, supplierNote: r.supplier_note ?? null, note: r.note ?? null,
    receivedOn: r.received_on ? String(r.received_on instanceof Date ? r.received_on.toISOString() : r.received_on).slice(0, 10) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    createdByName: (r.created_by && names.get(r.created_by)) || null,
  };
}

const RANGE_SELECT = `select r.*, r.first_number::text as first_number, r.last_number::text as last_number, f.name as format_name
  from tag_ranges r left join tag_formats f on f.id = r.format_id`;

async function formatOf(ctx: ModuleContext, id: unknown, field = 'formatId'): Promise<TagFormat | null> {
  if (id === undefined || id === null || id === '') return null;
  const row = UUID_RE.test(String(id)) ? await ctx.db.one<Row>('select * from tag_formats where id = $1 and deleted_at is null', [id]) : undefined;
  return row ? formatFromRow(row) : invalid(ctx, { [field]: 'Choose a tag format.' });
}

const textOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function notes(ctx: ModuleContext, b: Row, f: Record<string, string>) {
  const supplierNote = textOrNull(b.supplierNote);
  const note = textOrNull(b.note);
  if (supplierNote && supplierNote.length > MAX_NOTE) f.supplierNote = `Use at most ${MAX_NOTE} characters.`;
  if (note && note.length > MAX_NOTE) f.note = `Use at most ${MAX_NOTE} characters.`;
  const receivedOn = textOrNull(b.receivedOn);
  if (receivedOn && !DATE_RE.test(receivedOn)) f.receivedOn = 'Enter a date.';
  void ctx;
  return { supplierNote, note, receivedOn };
}

/** Inserts a sequence range (overlap checked on the same handle), returning its id. */
async function insertSequence(ctx: ModuleContext, db: Queryable, r: Omit<SeqRange, 'id' | 'prefixKey'> & {
  formatId: string | null; source: StockSource; seriesId: string | null; supplierNote: string | null; note: string | null; receivedOn: string | null; by: string | null;
}): Promise<string> {
  const shape: SeqRange = { ...r, id: '', prefixKey: valueKey(r.prefix) };
  const c = await clashes(db, keysOf(shape), shape);
  if (c.count) overlapFail(ctx, c);
  const row = await db.one<{ id: string }>(
    `insert into tag_ranges (format_id, kind, prefix, digits, first_number, last_number, first_key, last_key, check_character, source, series_id,
       supplier_note, note, received_on, created_by, updated_by)
     values ($1, 'sequence', $2, $3, $4::bigint, $5::bigint, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14) returning id`,
    [r.formatId, r.prefix, r.digits, r.first.toString(), r.last.toString(), valueKey(seqValue(shape, r.first)), valueKey(seqValue(shape, r.last)),
      r.check, r.source, r.seriesId, r.supplierNote, r.note, r.receivedOn, r.by]);
  return row!.id;
}

/**
 * Takes `count` numbers from a series in one atomic update and registers them as a printed range, in
 * one transaction: two people printing at once never get the same numbers, and a clash with other stock
 * takes nothing. Returns the values in order. Called by printing (TAGS-PRINT).
 */
export async function takeFromSeries(ctx: ModuleContext, seriesId: string, count: number, req: FastifyRequest | null): Promise<{ rangeId: string; values: string[] }> {
  const limit = Number(await ctx.settings.get(TAG_SETTINGS.printLimit.key, TAG_SETTINGS.printLimit.fallback));
  if (!Number.isInteger(count) || count < 1 || count > Math.min(limit, MAX_RANGE_SIZE)) invalid(ctx, { count: `Choose from 1 to ${Math.min(limit, MAX_RANGE_SIZE).toLocaleString('en-US')} tags.` });
  if (!UUID_RE.test(String(seriesId))) ctx.fail(404, 'not_found', 'Series not found.');
  const by = req?.user?.id ?? null;
  const out = await ctx.db.tx(async (tx) => {
    const s = await tx.one<Row>(
      `update tag_series set next_number = next_number + $2, updated_at = now(), updated_by = $3
       where id = $1 and deleted_at is null and active returning *, next_number::text as next_text`, [seriesId, count, by]);
    if (!s) return ctx.fail(404, 'not_found', 'Series not found, or switched off.');
    const last = BigInt(s.next_text) - 1n;
    const first = last - BigInt(count) + 1n;
    if (String(last).length > Number(s.digits)) ctx.fail(409, 'series_full', `The series ${s.name} has no ${count === 1 ? 'number' : `${count} numbers`} left in ${s.digits} digits.`);
    const shape = { prefix: s.prefix ?? '', digits: Number(s.digits), first, last, check: (s.check_character ?? 'none') as CheckScheme };
    const rangeId = await insertSequence(ctx, tx, {
      ...shape, formatId: s.format_id ?? null, source: 'printed', seriesId: s.id, supplierNote: null, note: `Printed from the series ${s.name}`, receivedOn: null, by,
    });
    const values: string[] = [];
    for (let n = first; n <= last; n += 1n) values.push(seqValue(shape, n));
    return { rangeId, values, name: s.name as string };
  });
  await ctx.audit(req, {
    action: 'tag.series.take', summary: `${out.values.length} numbers taken from the series ${out.name}: ${out.values[0]} to ${out.values[out.values.length - 1]}`,
    after: { seriesId, rangeId: out.rangeId, first: out.values[0], last: out.values[out.values.length - 1], count: out.values.length },
  });
  return { rangeId: out.rangeId, values: out.values };
}

function seriesView(r: Row): TagSeries {
  const next = BigInt(String(r.next_text ?? r.next_number));
  const shape = { prefix: r.prefix ?? '', digits: Number(r.digits), check: (r.check_character ?? 'none') as CheckScheme };
  return {
    id: r.id, name: r.name, formatId: r.format_id ?? null, prefix: shape.prefix, digits: shape.digits, nextNumber: Number(next),
    nextValue: String(next).length > shape.digits ? '' : seqValue(shape, next), active: r.active === true,
  };
}

export function registerStock(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const rangeById = async (id: unknown): Promise<Row> => {
    const r = UUID_RE.test(String(id)) ? await db.one<Row>(`${RANGE_SELECT} where r.id = $1 and r.deleted_at is null`, [id]) : undefined;
    return r ?? ctx.fail(404, 'not_found', 'Tag range not found.');
  };

  // ---------- ranges ----------

  app.get('/api/asset-tags/ranges', { preHandler: ctx.requirePerm('tags.view') }, async () => {
    const rows = await db.query<Row>(`${RANGE_SELECT} where r.deleted_at is null order by r.created_at desc`);
    const names = await namesOf(db, rows.map((r) => r.created_by));
    const out: StockRange[] = [];
    for (const r of rows) out.push(await rangeView(db, r, names));
    return out;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/ranges', summary: 'Tag stock', permission: 'tags.view',
    description: 'Ranges and lists of bought or printed tags, newest first, each with how many values are attached, available, void (replaced ones included) or lost.',
    response: { type: 'array', items: { type: 'object' } },
  });

  app.post('/api/asset-tags/ranges', { preHandler: ctx.requirePerm('tags.manage') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row & Partial<StockRangeInput>;
    const f: Record<string, string> = {};
    const format = await formatOf(ctx, b.formatId);
    const source: StockSource = b.source === 'printed' ? 'printed' : 'bought';
    if (b.source !== undefined && b.source !== 'bought' && b.source !== 'printed') f.source = 'Choose bought or printed.';
    const n = notes(ctx, b, f);
    const by = req.user!.id;
    let id: string;
    if (b.kind === 'sequence') {
      const prefix = cleanValue(b.prefix ?? format?.prefix ?? '');
      if (prefix.length > MAX_PREFIX) f.prefix = `Use at most ${MAX_PREFIX} characters.`;
      const digits = Number(b.digits);
      if (!Number.isInteger(digits) || digits < 1 || digits > 18) f.digits = 'Enter a whole number from 1 to 18.';
      const whole = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && /^\d{1,18}$/.test(v));
      if (!whole(b.first)) f.first = 'Enter the first number.';
      if (!whole(b.last)) f.last = 'Enter the last number.';
      if (Object.keys(f).length) invalid(ctx, f);
      const first = BigInt(String(b.first));
      const last = BigInt(String(b.last));
      if (first > last) invalid(ctx, { last: 'The last number cannot be before the first.' });
      if (String(last).length > digits) invalid(ctx, { last: `The last number has more than ${digits} digits.` });
      if (last - first + 1n > BigInt(MAX_RANGE_SIZE)) invalid(ctx, { last: `A range holds at most ${MAX_RANGE_SIZE.toLocaleString('en-US')} values; register larger stock in parts.` });
      const check = format?.checkCharacter ?? 'none';
      if (format) {
        for (const v of [seqValue({ prefix, digits, check }, first), seqValue({ prefix, digits, check }, last)]) {
          const m = matchFormat(v, format, 'typed');
          if (!m.ok) invalid(ctx, { formatId: `${v} does not match the format ${format.name}; check the prefix and the number of digits.` });
        }
      }
      id = await insertSequence(ctx, db, { prefix, digits, first, last, check, formatId: format?.id ?? null, source, seriesId: null, ...n, by });
    } else if (b.kind === 'list') {
      const raw = Array.isArray(b.values) ? b.values : null;
      if (!raw || !raw.length) f.values = 'Add at least one value.';
      else if (raw.length > MAX_RANGE_SIZE) f.values = `A list holds at most ${MAX_RANGE_SIZE.toLocaleString('en-US')} values.`;
      if (Object.keys(f).length) invalid(ctx, f);
      const values: { value: string; key: string }[] = [];
      const seen = new Set<string>();
      const dupes: string[] = []; const bad: string[] = []; const tooLong: string[] = [];
      for (const x of raw!) {
        const value = cleanValue(x);
        if (!value) continue;
        if (value.length > MAX_TAG_VALUE) { tooLong.push(value.slice(0, 20)); continue; }
        const key = valueKey(value);
        if (!key) continue;
        if (seen.has(key)) { dupes.push(value); continue; }
        if (format && !matchFormat(value, format, 'typed').ok) { bad.push(value); continue; }
        seen.add(key);
        values.push({ value, key });
      }
      const list = (xs: string[]) => `${xs.slice(0, NAMED).join(', ')}${xs.length > NAMED ? ` and ${xs.length - NAMED} more` : ''}`;
      if (tooLong.length) invalid(ctx, { values: `A tag value has at most ${MAX_TAG_VALUE} characters: ${list(tooLong)}.` });
      if (dupes.length) invalid(ctx, { values: `These values are in the list more than once: ${list(dupes)}.` });
      if (bad.length) invalid(ctx, { values: `These values do not match the format ${format!.name}: ${list(bad)}.` });
      if (!values.length) invalid(ctx, { values: 'Add at least one value.' });
      const c = await clashes(db, values.map((v) => v.key), null);
      if (c.count) overlapFail(ctx, c);
      id = await db.tx(async (tx) => {
        const row = await tx.one<{ id: string }>(
          `insert into tag_ranges (format_id, kind, prefix, first_key, last_key, check_character, source, supplier_note, note, received_on, created_by, updated_by)
           values ($1, 'list', '', $2, $3, $4, $5, $6, $7, $8, $9, $9) returning id`,
          [format?.id ?? null, values[0].key, values[values.length - 1].key, format?.checkCharacter ?? 'none', source, n.supplierNote, n.note, n.receivedOn, by]);
        for (let i = 0; i < values.length; i += 1000) {
          const part = values.slice(i, i + 1000);
          await tx.query(
            `insert into tag_range_values (range_id, value, value_key) select $1, v, k from unnest($2::text[], $3::text[]) as t(v, k)`,
            [row!.id, part.map((v) => v.value), part.map((v) => v.key)]);
        }
        return row!.id;
      });
    } else {
      return invalid(ctx, { kind: 'Choose a range of numbers or a list of values.' });
    }
    const r = await rangeById(id);
    const view = await rangeView(db, r, await namesOf(db, [by]));
    await ctx.audit(req, {
      action: 'tag.range.create', summary: `Tag stock registered: ${view.firstValue} to ${view.lastValue} (${view.size} ${view.size === 1 ? 'value' : 'values'}, ${view.source})`,
      after: { id: view.id, kind: view.kind, formatId: view.formatId, firstValue: view.firstValue, lastValue: view.lastValue, size: view.size, source: view.source, supplierNote: view.supplierNote, note: view.note, receivedOn: view.receivedOn },
    });
    reply.code(201);
    return view;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/ranges', summary: 'Register tag stock', permission: 'tags.manage',
    description: 'A sequential range ({ kind: "sequence", prefix, digits, first, last }) or a list of values ({ kind: "list", values }), at most 100,000 values. Refused with 409 `overlap` when any value is already in stock or attached to a record.',
    body: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: ['sequence', 'list'] }, formatId: { type: ['string', 'null'] }, prefix: { type: 'string' }, digits: { type: 'integer' }, first: { type: 'integer' }, last: { type: 'integer' }, values: { type: 'array', items: { type: 'string' } }, source: { type: 'string', enum: ['bought', 'printed'] }, supplierNote: { type: 'string' }, note: { type: 'string' }, receivedOn: { type: ['string', 'null'], format: 'date' } } },
    response: { type: 'object' },
  });

  app.patch('/api/asset-tags/ranges/:id', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const r = await rangeById((req.params as Row).id);
    const b = (req.body ?? {}) as Row;
    const f: Record<string, string> = {};
    const n = notes(ctx, b, f);
    if (Object.keys(f).length) invalid(ctx, f);
    const next = {
      supplierNote: 'supplierNote' in b ? n.supplierNote : r.supplier_note ?? null,
      note: 'note' in b ? n.note : r.note ?? null,
      receivedOn: 'receivedOn' in b ? n.receivedOn : r.received_on ?? null,
    };
    await db.query(`update tag_ranges set supplier_note = $2, note = $3, received_on = $4, updated_at = now(), updated_by = $5 where id = $1`,
      [r.id, next.supplierNote, next.note, next.receivedOn, req.user!.id]);
    const after = await rangeById(r.id);
    const view = await rangeView(db, after, await namesOf(db, [after.created_by]));
    await ctx.audit(req, { action: 'tag.range.update', summary: `Tag stock notes changed: ${view.firstValue} to ${view.lastValue}`, before: { supplierNote: r.supplier_note, note: r.note, receivedOn: r.received_on }, after: next });
    return view;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/asset-tags/ranges/:id', summary: 'Change the notes of tag stock', permission: 'tags.manage',
    body: { type: 'object', properties: { supplierNote: { type: ['string', 'null'] }, note: { type: ['string', 'null'] }, receivedOn: { type: ['string', 'null'], format: 'date' } } },
  });

  app.delete('/api/asset-tags/ranges/:id', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const r = await rangeById((req.params as Row).id);
    const counts = await rangeCounts(db, r);
    if (counts.attached > 0) ctx.fail(409, 'in_use', `${counts.attached} ${counts.attached === 1 ? 'value of this stock is' : 'values of this stock are'} attached to records, so it cannot be removed.`);
    const view = await rangeView(db, r, new Map());
    await db.tx(async (tx) => {
      await tx.query('update tag_ranges set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [r.id, req.user!.id]);
      // The values are free to be registered again; their marks go with them.
      await tx.query('delete from tag_stock_marks where range_id = $1', [r.id]);
      await tx.query('delete from tag_range_values where range_id = $1', [r.id]);
    });
    await ctx.audit(req, { action: 'tag.range.delete', summary: `Tag stock removed: ${view.firstValue} to ${view.lastValue}`, before: { id: r.id, firstValue: view.firstValue, lastValue: view.lastValue, size: view.size } });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/asset-tags/ranges/:id', summary: 'Remove tag stock (refused while any of its values is attached)', permission: 'tags.manage' });

  app.get('/api/asset-tags/ranges/:id/values', { preHandler: ctx.requirePerm('tags.view') }, async (req): Promise<StockValuesPage> => {
    const r = await rangeById((req.params as Row).id);
    const q = (req.query ?? {}) as Row;
    const { page, pageSize } = pageOf(q);
    const wanted = typeof q.state === 'string' && q.state ? new Set(q.state.split(',')) : null;
    const search = typeof q.q === 'string' ? valueKey(q.q) : '';
    const { byKey } = await rangeStates(db, r);
    // Values in order, with their state; only one page is built into rows.
    const all: { value: string; key: string }[] = [];
    if (r.kind === 'sequence') {
      const s = seqFromRow(r);
      for (let n = s.first; n <= s.last; n += 1n) { const value = seqValue(s, n); all.push({ value, key: valueKey(value) }); }
    } else {
      for (const v of await db.query<{ value: string; value_key: string }>('select value, value_key from tag_range_values where range_id = $1 order by value', [r.id])) {
        all.push({ value: v.value, key: v.value_key });
      }
    }
    const matching = all.filter((v) => (!search || v.key.includes(search)) && (!wanted || wanted.has(byKey.get(v.key)?.state ?? 'available')));
    const slice = matching.slice((page - 1) * pageSize, page * pageSize);
    const rows: StockValuesPage['rows'] = [];
    for (const v of slice) {
      const s = byKey.get(v.key);
      let recordLabel: string | null = null; let route: string | null = null;
      let recordType = s?.recordType ?? null; let recordId = s?.recordId ?? null;
      if (recordType && recordId) {
        const def = ctx.resources.get(recordType);
        const visible = def && ctx.can(req.user!, `${def.module}.view`) && (await ctx.resources.find(recordType, recordId, req.user));
        if (def && visible) { recordLabel = await ctx.resources.labelFor(recordType, recordId); route = `${def.route}/${recordId}`; } else { recordType = null; recordId = null; }
      }
      rows.push({ value: v.value, key: v.key, state: s?.state ?? 'available', recordType, recordId, recordLabel, route });
    }
    return { rows, total: matching.length, page, pageSize };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/ranges/:id/values', summary: 'The values of tag stock, with their state', permission: 'tags.view',
    description: 'Each value as available, attached (with the record, when the caller may see it), replaced, void or lost.',
    query: { state: 'Comma-separated states: available, attached, replaced, void, lost', q: 'Part of a value', page: 'Page (from 1)', pageSize: 'Rows a page (at most 500)' },
    response: { type: 'object', properties: { rows: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } },
  });

  app.post('/api/asset-tags/stock/mark', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const b = (req.body ?? {}) as Partial<StockMarkRequest>;
    if (!['void', 'lost', 'available'].includes(String(b.status))) invalid(ctx, { status: 'Choose void, lost or available.' });
    if (!Array.isArray(b.values) || !b.values.length || b.values.length > 1000) invalid(ctx, { values: 'Choose from 1 to 1,000 values.' });
    const reason = textOrNull(b.reason);
    if (reason && reason.length > MAX_NOTE) invalid(ctx, { reason: `Use at most ${MAX_NOTE} characters.` });
    const notInStock: string[] = []; const attached: string[] = [];
    const items: { value: string; key: string; rangeId: string }[] = [];
    for (const raw of b.values!) {
      const value = cleanValue(raw); const key = valueKey(value);
      if (!key) continue;
      const st = await stockStatus(db, key);
      if (!st.inStock) { notInStock.push(value); continue; }
      const active = await db.one('select 1 from tag_assignments where value_key = $1 and status = \'active\'', [key]);
      if (active) { attached.push(value); continue; }
      items.push({ value, key, rangeId: st.rangeId! });
    }
    if (notInStock.length) invalid(ctx, { values: `Not in your tag stock: ${notInStock.slice(0, NAMED).join(', ')}.` });
    if (attached.length) invalid(ctx, { values: `Attached to a record (end the tag on the record instead): ${attached.slice(0, NAMED).join(', ')}.` });
    for (const it of items) {
      if (b.status === 'available') await db.query('delete from tag_stock_marks where value_key = $1', [it.key]);
      else {
        await db.query(
          `insert into tag_stock_marks (value_key, value, range_id, status, reason, marked_by) values ($1, $2, $3, $4, $5, $6)
           on conflict (value_key) do update set status = excluded.status, reason = excluded.reason, marked_at = now(), marked_by = excluded.marked_by`,
          [it.key, it.value, it.rangeId, b.status, reason, req.user!.id]);
      }
    }
    await ctx.audit(req, {
      action: 'tag.range.mark', summary: `${items.length} tag ${items.length === 1 ? 'value' : 'values'} marked ${b.status}: ${items.slice(0, NAMED).map((i) => i.value).join(', ')}${items.length > NAMED ? ' and more' : ''}`,
      after: { status: b.status, reason, values: items.map((i) => i.value) },
    });
    return { marked: items.length };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/stock/mark', summary: 'Mark stock values void or lost (or available again)', permission: 'tags.manage',
    description: 'For values in stock that were never attached. An attached value is ended on its record instead.',
    body: { type: 'object', required: ['values', 'status'], properties: { values: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: ['void', 'lost', 'available'] }, reason: { type: 'string' } } },
    response: { type: 'object', properties: { marked: { type: 'integer' } } },
  });

  // ---------- series ----------

  const seriesById = async (id: unknown): Promise<Row> => {
    const r = UUID_RE.test(String(id)) ? await db.one<Row>('select *, next_number::text as next_text from tag_series where id = $1 and deleted_at is null', [id]) : undefined;
    return r ?? ctx.fail(404, 'not_found', 'Series not found.');
  };

  async function checkSeries(b: Partial<TagSeriesInput>, stored: Row | null): Promise<Row> {
    const f: Record<string, string> = {};
    const has = (k: keyof TagSeriesInput) => k in b;
    const name = has('name') ? String(b.name ?? '').trim() : String(stored?.name ?? '');
    if (!name) f.name = 'Enter a name.'; else if (name.length > 80) f.name = 'Use at most 80 characters.';
    const format = has('formatId') ? await formatOf(ctx, b.formatId) : stored?.format_id ? await formatOf(ctx, stored.format_id) : null;
    const prefix = cleanValue(has('prefix') ? b.prefix ?? '' : stored ? stored.prefix ?? '' : format?.prefix ?? '');
    if (prefix.length > MAX_PREFIX) f.prefix = `Use at most ${MAX_PREFIX} characters.`;
    const digits = has('digits') ? Number(b.digits) : Number(stored?.digits);
    if (!Number.isInteger(digits) || digits < 1 || digits > 18) f.digits = 'Enter a whole number from 1 to 18.';
    const nextNumber = has('nextNumber') ? Number(b.nextNumber) : stored ? Number(stored.next_text) : 1;
    if (!Number.isSafeInteger(nextNumber) || nextNumber < 0) f.nextNumber = 'Enter a whole number, zero or more.';
    else if (!f.digits && String(nextNumber).length > digits) f.nextNumber = `The next number has more than ${digits} digits.`;
    const active = has('active') ? b.active === true : stored ? stored.active === true : true;
    const check: CheckScheme = format?.checkCharacter ?? 'none';
    if (!Object.keys(f).length && format && !matchFormat(seqValue({ prefix, digits, check }, BigInt(nextNumber)), format, 'typed').ok) {
      f.formatId = `The numbers of this series would not match the format ${format.name}; check the prefix and the number of digits.`;
    }
    if (Object.keys(f).length) invalid(ctx, f);
    return { name, format_id: format?.id ?? null, prefix, digits, next_number: nextNumber, active, check_character: check };
  }

  app.get('/api/asset-tags/series', { preHandler: ctx.requirePerm('tags.view') }, async () =>
    (await db.query<Row>('select *, next_number::text as next_text from tag_series where deleted_at is null order by active desc, lower(name)')).map(seriesView));
  ctx.describeRoute({ method: 'GET', path: '/api/asset-tags/series', summary: 'Series for printing your own tags', permission: 'tags.view', response: { type: 'array', items: { type: 'object' } } });

  const SERIES_BODY = { type: 'object', properties: { name: { type: 'string' }, formatId: { type: ['string', 'null'] }, prefix: { type: 'string' }, digits: { type: 'integer' }, nextNumber: { type: 'integer' }, active: { type: 'boolean' } } };

  app.post('/api/asset-tags/series', { preHandler: ctx.requirePerm('tags.manage') }, async (req, reply) => {
    const c = await checkSeries((req.body ?? {}) as Partial<TagSeriesInput>, null);
    const row = (await db.one<Row>(
      `insert into tag_series (name, format_id, prefix, digits, next_number, active, check_character, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning *, next_number::text as next_text`,
      [c.name, c.format_id, c.prefix, c.digits, c.next_number, c.active, c.check_character, req.user!.id]))!;
    const view = seriesView(row);
    await ctx.audit(req, { action: 'tag.series.create', summary: `Tag series added: ${view.name} (next ${view.nextValue})`, after: view });
    reply.code(201);
    return view;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/asset-tags/series', summary: 'Add a series for printing your own tags', permission: 'tags.manage', body: SERIES_BODY });

  app.patch('/api/asset-tags/series/:id', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const stored = await seriesById((req.params as Row).id);
    const before = seriesView(stored);
    const c = await checkSeries((req.body ?? {}) as Partial<TagSeriesInput>, stored);
    const row = (await db.one<Row>(
      `update tag_series set name = $2, format_id = $3, prefix = $4, digits = $5, next_number = $6, active = $7, check_character = $8, updated_at = now(), updated_by = $9
       where id = $1 returning *, next_number::text as next_text`,
      [stored.id, c.name, c.format_id, c.prefix, c.digits, c.next_number, c.active, c.check_character, req.user!.id]))!;
    const after = seriesView(row);
    await ctx.audit(req, { action: 'tag.series.update', summary: `Tag series changed: ${after.name}`, before, after });
    return after;
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/asset-tags/series/:id', summary: 'Change a series', permission: 'tags.manage', body: SERIES_BODY,
    description: 'Moving the next number back is allowed; numbers already registered as stock are refused when printed again (409 `overlap`).',
  });
}
