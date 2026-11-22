// Asking the server about readings (spec §4.2 and §5.5 step 5, E38-05): `POST /api/asset-tags/lookup`
// with up to 10 candidates (each reading's value, then its look-alike variants), and what the answer
// means for each reading. The server decides everything that depends on records and permissions; the
// app never picks between two different records by itself.
import { apiFetch } from '../api/client';
import { valueKey, type TagSource } from '../../../shared/tag-format.ts';
import { MAX_LOOKUP_CANDIDATES, type LookupCandidate, type LookupResponse, type LookupResult } from '../../../shared/asset-tags-api.ts';
import type { Reading } from './read';

/** What a reading turned out to be. */
export type ReadingStatus =
  | 'record'     // one record: open its tag card
  | 'choose'     // several different records (look-alike variants or identifiers): the person chooses
  | 'stock'      // in stock or matching a format but not attached: Attach (when allowed)
  | 'misread'    // a check character that does not match
  | 'nothing';   // nothing found

export interface ReadingAnswer {
  reading: Reading;
  status: ReadingStatus;
  /** The result to show (record or stock), or the first result for a message. */
  result: LookupResult | null;
  /** For `choose`: one result per distinct record. */
  choices: LookupResult[];
  message: string;
}

/** The source the server logs for a reading. */
export function sourceOf(r: Pick<Reading, 'how'> | 'typed'): TagSource {
  if (r === 'typed') return 'typed';
  return r.how === 'text' ? 'text' : 'code';
}

/**
 * The candidates to send: every reading's own value first (in order), then their variants, at most
 * MAX_LOOKUP_CANDIDATES, without repeating a value key. `owner[i]` is the reading candidate i belongs to.
 */
export function candidatesFor(readings: Reading[]): { candidates: LookupCandidate[]; owner: number[] } {
  const candidates: LookupCandidate[] = [];
  const owner: number[] = [];
  const keys = new Set<string>();
  const add = (value: string, i: number) => {
    const key = valueKey(value);
    if (!key || keys.has(key) || candidates.length >= MAX_LOOKUP_CANDIDATES) return;
    keys.add(key);
    candidates.push({ value, source: sourceOf(readings[i]) });
    owner.push(i);
  };
  readings.forEach((r, i) => add(r.value, i));
  const most = Math.max(0, ...readings.map((r) => r.variants.length));
  for (let v = 0; v < most; v++) readings.forEach((r, i) => { if (r.variants[v]) add(r.variants[v], i); });
  return { candidates, owner };
}

const recordKey = (c: { recordType: string; recordId: string }) => `${c.recordType}:${c.recordId}`;

/** Interprets the results that belong to one reading (its value and variants, in the order sent). */
export function interpret(reading: Reading, results: LookupResult[]): ReadingAnswer {
  const base = { reading, choices: [] as LookupResult[] };
  // Tag values first (current, then replaced), then other identifiers.
  const tagHits = results.filter((r) => (r.outcome === 'current' || r.outcome === 'replaced') && r.cards.length);
  const idHits = results.filter((r) => r.outcome === 'identifier' && r.cards.length);
  const hits = tagHits.length ? tagHits : idHits;
  if (hits.length) {
    const distinct = new Map<string, LookupResult>();
    for (const h of hits) for (const c of h.cards) if (!distinct.has(recordKey(c))) distinct.set(recordKey(c), { ...h, cards: [c] });
    if (distinct.size === 1) {
      const only = [...distinct.values()][0];
      const result = hits.find((h) => h.cards.some((c) => recordKey(c) === recordKey(only.cards[0]))) ?? only;
      return { ...base, status: 'record', result, message: result.message };
    }
    const choices = [...distinct.values()];
    return { ...base, status: 'choose', result: null, choices, message: `${choices.length} records match ${reading.value}. Choose the right one.` };
  }
  const stock = results.find((r) => r.outcome === 'in_stock') ?? results.find((r) => r.outcome === 'unknown_format');
  if (stock) return { ...base, status: 'stock', result: stock, message: stock.message };
  const first = results[0] ?? null;
  if (results.length && results.every((r) => r.outcome === 'misread')) {
    return { ...base, status: 'misread', result: first, message: first?.message ?? `${reading.value} was not read correctly.` };
  }
  const own = results.find((r) => r.key === reading.key) ?? first;
  return { ...base, status: 'nothing', result: own, message: own?.message ?? `Nothing found for ${reading.value}.` };
}

/** Splits one lookup answer between the readings it was asked for. */
export function answersFrom(readings: Reading[], owner: number[], response: LookupResponse): ReadingAnswer[] {
  return readings.map((r, i) => interpret(r, response.results.filter((_, j) => owner[j] === i)));
}

/** Asks the server about readings (at most 10 values in one request; readings left over wait for the next). */
export async function lookUp(readings: Reading[], signal?: AbortSignal): Promise<ReadingAnswer[]> {
  if (!readings.length) return [];
  const { candidates, owner } = candidatesFor(readings);
  const asked = readings.filter((_, i) => owner.includes(i));
  const response = await apiFetch<LookupResponse>('/api/asset-tags/lookup', { method: 'POST', body: { candidates }, signal });
  const remap = owner.map((i) => asked.indexOf(readings[i]));
  return answersFrom(asked, remap, response);
}

/** A value typed on the keyboard: looked up as typed (never corrected). */
export function typedReading(text: string): Reading {
  const value = text.trim();
  return { key: valueKey(value), value, how: 'text', trust: 'exact', formatId: null, variants: [value] };
}

/** Looks up a typed value (source `typed`). */
export async function lookUpTyped(text: string, signal?: AbortSignal): Promise<ReadingAnswer> {
  const reading = typedReading(text);
  const response = await apiFetch<LookupResponse>('/api/asset-tags/lookup', {
    method: 'POST', body: { candidates: [{ value: reading.value, source: 'typed' }] }, signal,
  });
  return interpret(reading, response.results);
}
