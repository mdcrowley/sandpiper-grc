// The tag photo test set (spec §5.5, E38-05): runs the app's value rules (src/tags) on the recognizer
// output recorded for each photo in set.json, against a stand-in server that knows each scenario's
// records, stock and formats, and measures how often the camera screen ends with the right record or
// a correct "couldn't find". Target: at least 98%, and never a wrong record.
//
// A photo goes the way a person would use the screen: the live frames are read; if nothing could be
// acted on or confirmed, the person presses the shutter (the still picture); readings that need
// confirmation are confirmed only when they show what is printed on the tag. Pictures and their
// recognizer output come from generate.mjs (synthetic, invented values); replace a photo's `live`
// and `still` with output logged from a phone or an emulator to measure the real recognizers.
import set from './set.json';
import { TagReader } from '../../src/tags/reader';
import { actsAlone, type FrameReads, type Reading } from '../../src/tags/read';
import { answersFrom, candidatesFor, interpret, type ReadingAnswer } from '../../src/tags/lookup';
import { decide } from '../../src/tags/decide';
import { matchFormat, valueKey, type TagFormat } from '../../../shared/tag-format.ts';
import type { LookupCandidate, LookupResponse, LookupResult, TagCard } from '../../../shared/asset-tags-api.ts';

interface Expect { kind: 'record' | 'stock' | 'none'; values?: string[]; stock?: string[] }
interface Photo { id: string; scenario: string; description: string; codeTypes: string[]; effects: string[]; expect: Expect; live: FrameReads[]; still: FrameReads }
interface Scenario { label: string; formats: TagFormat[]; decoys: Record<string, string> }
const photos = set.photos as unknown as Photo[];
const scenarios = set.scenarios as unknown as Record<string, Scenario>;

/** A stand-in for POST /api/asset-tags/lookup (spec §4.2 rules 1, 3, 6 and the check-character refusal). */
function server(scenario: string) {
  const formats = scenarios[scenario].formats;
  const records = new Map<string, string>();
  const stock = new Set<string>();
  for (const p of photos.filter((x) => x.scenario === scenario)) {
    if (p.expect.kind === 'record') for (const v of p.expect.values ?? []) records.set(valueKey(v), `asset:${valueKey(v)}`);
    for (const v of [...(p.expect.kind === 'stock' ? p.expect.values ?? [] : []), ...(p.expect.stock ?? [])]) stock.add(valueKey(v));
  }
  for (const [v, rec] of Object.entries(scenarios[scenario].decoys)) records.set(valueKey(v), rec);
  const one = (c: LookupCandidate): LookupResult => {
    const key = valueKey(c.value);
    const base = { candidate: c, key, cards: [] as TagCard[], replacedBy: null, matchedBy: null, formatId: null, actions: [] };
    if (formats.some((f) => matchFormat(c.value, f, c.source).ok === false && (matchFormat(c.value, f, c.source) as { reason: string }).reason === 'check')
      && !formats.some((f) => matchFormat(c.value, f, c.source).ok)) {
      return { ...base, outcome: 'misread', message: `${c.value} was not read correctly.` };
    }
    const rec = records.get(key);
    if (rec) {
      const [recordType, recordId] = rec.split(':');
      return { ...base, outcome: 'current', message: '', cards: [{ recordType, recordId } as TagCard] };
    }
    if (stock.has(key)) return { ...base, outcome: 'in_stock', message: `Tag ${c.value} is not attached yet.` };
    return { ...base, outcome: 'nothing', message: `Nothing found for ${c.value}.` };
  };
  return (candidates: LookupCandidate[]): LookupResponse => {
    if (candidates.length < 1 || candidates.length > 10) throw new Error(`lookup with ${candidates.length} candidates`);
    return { results: candidates.map(one), records: 0 };
  };
}

const ask = (lookup: ReturnType<typeof server>, readings: Reading[]): ReadingAnswer[] => {
  if (!readings.length) return [];
  const { candidates, owner } = candidatesFor(readings);
  return answersFrom(readings, owner, lookup(candidates));
};

type Verdict = 'right' | 'wrong' | 'missed';
interface Run { verdict: Verdict; opened: string[]; how: string; note: string }

function run(photo: Photo): Run {
  const { formats } = scenarios[photo.scenario];
  const lookup = server(photo.scenario);
  const truthKeys = new Set((photo.expect.values ?? []).map(valueKey));
  const truthRecords = new Set([...truthKeys].map((k) => `asset:${k}`));
  const reader = new TagReader(formats);
  photo.live.forEach((f, i) => reader.observe(f, i * 150));
  let readings = reader.all();
  const useful = (rs: Reading[]) => rs.some(actsAlone) || rs.some((r) => truthKeys.has(r.key));
  let how = 'live';
  if (!useful(readings)) { reader.observe(photo.still, photo.live.length * 150 + 500); readings = reader.all(); how = 'still'; }

  // Automatic: readings that act alone are looked up; the screen opens one card or lists them.
  const answers = ask(lookup, readings.filter(actsAlone));
  const outcome = decide(answers, readings);
  const shown: ReadingAnswer[] = outcome.open ? [outcome.open] : [...outcome.list];
  // The person confirms what matches the printed tag (and nothing else).
  for (const r of outcome.confirm) {
    if (!truthKeys.has(r.key) && !r.variants.some((v) => truthKeys.has(valueKey(v)))) continue;
    const { candidates, owner } = candidatesFor([r]);
    shown.push(interpret(r, lookup(candidates).results.filter((_, j) => owner[j] === 0)));
    how += '+confirmed';
  }
  // Records the screen showed (a choice between records: the person picks the one printed, if any).
  const opened: string[] = [];
  for (const a of shown) {
    if (a.status === 'record' && a.result) opened.push(...a.result.cards.map((c) => `${c.recordType}:${c.recordId}`));
    if (a.status === 'choose') opened.push(...a.choices.flatMap((c) => c.cards.map((x) => `${x.recordType}:${x.recordId}`)).filter((r) => truthRecords.has(r)));
  }
  const wrong = opened.filter((r) => !truthRecords.has(r));
  if (wrong.length) return { verdict: 'wrong', opened, how, note: `showed ${wrong.join(', ')}` };
  const stockShown = shown.filter((a) => a.status === 'stock').map((a) => a.reading.key);
  const wantStock = [...(photo.expect.kind === 'stock' ? photo.expect.values ?? [] : []), ...(photo.expect.stock ?? [])].map(valueKey);
  const okRecords = photo.expect.kind !== 'record' || [...truthRecords].every((r) => opened.includes(r));
  const okStock = wantStock.every((k) => stockShown.includes(k));
  const okNone = photo.expect.kind !== 'none' || opened.length === 0;
  const right = okRecords && okStock && okNone && (photo.expect.kind !== 'stock' || opened.length === 0);
  return { verdict: right ? 'right' : 'missed', opened, how, note: right ? '' : `readings ${readings.map((r) => `${r.key}/${r.trust}`).join(' ') || 'none'}` };
}

declare const __dirname: string;

// Reads logged by the real recognizers on a device (import-reads.mjs), when present: each picture
// read once as a still picture.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { existsSync(p: string): boolean; readFileSync(p: string, encoding: 'utf8'): string };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realFile = (require('path') as { join(...p: string[]): string }).join(__dirname, 'real-reads.json');
const real = fs.existsSync(realFile) ? JSON.parse(fs.readFileSync(realFile, 'utf8')) as { recordedOn: string; device: string; reads: Record<string, FrameReads> } : null;

(real ? describe : describe.skip)('tag photo test set, real recognizers', () => {
  it('reaches the right record or a correct "couldn\'t find", never a wrong record', () => {
    const photosRead = photos.filter((p) => real!.reads[p.id]);
    const runs = photosRead.map((p) => ({ photo: p, ...run({ ...p, live: [], still: real!.reads[p.id] }) }));
    const right = runs.filter((r) => r.verdict === 'right').length;
    const table = runs.filter((r) => r.verdict !== 'right').map((r) => `${r.verdict.padEnd(6)} ${r.photo.id}  (${r.note})`);
    console.log(`Real recognizers (${real!.device}, ${real!.recordedOn}): ${right} of ${runs.length} right (${((right / Math.max(1, runs.length)) * 100).toFixed(1)}%), ${runs.filter((r) => r.verdict === 'wrong').length} wrong; ${photos.length - photosRead.length} pictures not read\n${table.join('\n')}`);
    expect(runs.filter((r) => r.verdict === 'wrong').map((r) => r.photo.id)).toEqual([]);
    expect(right / Math.max(1, runs.length)).toBeGreaterThanOrEqual(0.98);
  });
});

describe('tag photo test set', () => {
  const runs = photos.map((p) => ({ photo: p, ...run(p) }));

  it('covers every code type, plain digits, letters and digits, both, several tags and every effect', () => {
    const types = new Set(photos.flatMap((p) => p.codeTypes));
    for (const t of ['qr-code', 'data-matrix', 'pdf-417', 'aztec', 'code-128', 'code-39', 'code-93', 'ean-8', 'ean-13', 'upc-a', 'upc-e', 'itf', 'codabar']) expect(types).toContain(t);
    const effects = new Set(photos.flatMap((p) => p.effects));
    for (const e of ['rotate', 'blur', 'glare', 'contrast', 'noise']) expect(effects).toContain(e);
    expect(photos.some((p) => (p.expect.values?.length ?? 0) > 1)).toBe(true);
    expect(photos.length).toBeGreaterThanOrEqual(50);
  });

  it('works with no tag formats configured', () => {
    expect(scenarios.none.formats).toEqual([]);
    expect(runs.filter((r) => r.photo.scenario === 'none').every((r) => r.verdict === 'right')).toBe(true);
  });

  it('never shows a wrong record', () => {
    expect(runs.filter((r) => r.verdict === 'wrong').map((r) => `${r.photo.id}: ${r.note}`)).toEqual([]);
  });

  it('reaches the right record or a correct "couldn\'t find" on at least 98% of the photos', () => {
    const right = runs.filter((r) => r.verdict === 'right').length;
    const rate = right / runs.length;
    const table = runs.map((r) => `${r.verdict.padEnd(6)} ${r.how.padEnd(16)} ${r.photo.scenario.padEnd(8)} ${r.photo.id}${r.note ? `  (${r.note})` : ''}`);
    // The measurement, for the roadmap and the report.
    console.log(`Tag photo test set: ${right} of ${runs.length} right (${(rate * 100).toFixed(1)}%), ${runs.filter((r) => r.verdict === 'wrong').length} wrong\n${table.join('\n')}`);
    expect(rate).toBeGreaterThanOrEqual(0.98);
  });
});
