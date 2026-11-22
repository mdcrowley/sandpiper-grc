import { candidatesFor, interpret, lookUp, lookUpTyped } from './lookup';
import type { Reading } from './read';
import type { LookupResult, TagCard } from '../../../shared/asset-tags-api.ts';

jest.mock('../api/client', () => ({ apiFetch: jest.fn() }));
const { apiFetch } = jest.requireMock('../api/client') as { apiFetch: jest.Mock };

const reading = (value: string, over: Partial<Reading> = {}): Reading => ({
  key: value.replace(/[-\s]/g, '').toUpperCase(), value, how: 'code', trust: 'exact', formatId: null, variants: [value], ...over,
});
const card = (id: string): TagCard => ({ recordType: 'asset', recordId: id, typeLabel: 'Asset', route: `/assets/${id}`, title: `Pump ${id}` } as TagCard);
const result = (value: string, outcome: LookupResult['outcome'], cards: TagCard[] = []): LookupResult => ({
  candidate: { value, source: 'code' }, key: value.toUpperCase(), outcome, message: `${outcome} ${value}`, cards,
  replacedBy: null, matchedBy: null, formatId: null, actions: [],
});

describe('candidates', () => {
  it('sends every reading first, then variants, at most 10, without repeats', () => {
    const many = Array.from({ length: 4 }, (_, i) => reading(`V${i}`, { variants: [`V${i}`, `W${i}`, `X${i}`, `Y${i}`] }));
    const { candidates, owner } = candidatesFor(many);
    expect(candidates).toHaveLength(10);
    expect(candidates.slice(0, 4).map((c) => c.value)).toEqual(['V0', 'V1', 'V2', 'V3']);
    expect(owner.slice(4, 8)).toEqual([0, 1, 2, 3]);
    expect(candidates[0].source).toBe('code');
    expect(candidatesFor([reading('A1', { how: 'text' })]).candidates[0].source).toBe('text');
  });
});

describe('interpreting answers', () => {
  it('one record → its card', () => {
    const a = interpret(reading('TA-1'), [result('TA-1', 'current', [card('1')])]);
    expect(a.status).toBe('record');
    expect(a.result?.cards[0].recordId).toBe('1');
  });

  it('variants that find different records → the person chooses', () => {
    const a = interpret(reading('K0', { variants: ['K0', 'KO'] }), [result('K0', 'current', [card('1')]), result('KO', 'current', [card('2')])]);
    expect(a.status).toBe('choose');
    expect(a.choices).toHaveLength(2);
  });

  it('a tag value wins over another identifier', () => {
    const a = interpret(reading('X', { variants: ['X', 'Y'] }), [result('X', 'identifier', [card('9')]), result('Y', 'current', [card('1')])]);
    expect(a.result?.cards[0].recordId).toBe('1');
  });

  it('in stock → stock; check character wrong → misread; else nothing', () => {
    expect(interpret(reading('A'), [result('A', 'in_stock')]).status).toBe('stock');
    expect(interpret(reading('A'), [result('A', 'misread')]).status).toBe('misread');
    expect(interpret(reading('A'), [result('A', 'nothing')])).toMatchObject({ status: 'nothing', message: 'nothing A' });
  });
});

describe('calling the server', () => {
  beforeEach(() => apiFetch.mockReset());

  it('posts the candidates and splits the answer', async () => {
    apiFetch.mockResolvedValue({ results: [result('A', 'current', [card('1')]), result('B', 'nothing')], records: 1 });
    const answers = await lookUp([reading('A'), reading('B')]);
    expect(apiFetch).toHaveBeenCalledWith('/api/asset-tags/lookup', expect.objectContaining({ method: 'POST', body: { candidates: [{ value: 'A', source: 'code' }, { value: 'B', source: 'code' }] } }));
    expect(answers.map((a) => a.status)).toEqual(['record', 'nothing']);
  });

  it('typed values go as typed', async () => {
    apiFetch.mockResolvedValue({ results: [result('ta-118342', 'current', [card('1')])], records: 1 });
    await lookUpTyped(' ta-118342 ');
    expect(apiFetch.mock.calls[0][1].body).toEqual({ candidates: [{ value: 'ta-118342', source: 'typed' }] });
  });
});
