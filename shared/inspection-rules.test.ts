import { describe, expect, it } from 'vitest';
import { completionProblem, findingRatingOf, liveItems, scoreChecklist, type RuleAnswer, type RuleItem } from './inspection-rules.ts';

// The rules of completing an inspection (E24-06), shared by the server and the mobile app (E38-11).

const item = (id: string, over: Partial<RuleItem> = {}): RuleItem => ({ id, prompt: `Invented item ${id}`, critical: false, photo_required: false, ...over });
const answers = (m: Record<string, RuleAnswer>) => (id: string) => m[id];

describe('inspection rules', () => {
  it('counts removed items only when they were answered', () => {
    const items = [item('a'), item('b', { removed: true }), item('c', { removed: true })];
    expect(liveItems(items, answers({ b: { answer: 'yes', photos: 0 } })).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('needs every item answered, then a photo where one is needed unless not applicable', () => {
    const items = [item('a'), item('b', { photo_required: true }), item('c', { photo_required: true })];
    const open = completionProblem(items, answers({ a: { answer: 'yes', photos: 0 } }));
    expect(open).toMatchObject({ code: 'incomplete', message: 'Answer every item first: 2 still open.', items: ['b', 'c'] });
    const photo = completionProblem(items, answers({ a: { answer: 'yes', photos: 0 }, b: { answer: 'no', photos: 0 }, c: { answer: 'na', photos: 0 } }));
    expect(photo).toMatchObject({ code: 'photo_required', items: ['b'] });
    expect(photo!.message).toBe('Add a photo to every item that needs one: Invented item b.');
    expect(completionProblem(items, answers({ a: { answer: 'yes', photos: 0 }, b: { answer: 'no', photos: 1 }, c: { answer: 'na', photos: 0 } }))).toBeNull();
  });

  it('fails on a critical item not met, gives findings otherwise, and scores met out of yes and no', () => {
    const items = [item('a', { critical: true }), item('b'), item('c'), item('d')];
    const pass = scoreChecklist(items, answers({ a: { answer: 'yes', photos: 0 }, b: { answer: 'yes', photos: 0 }, c: { answer: 'na', photos: 0 }, d: { answer: 'yes', photos: 0 } }));
    expect(pass).toMatchObject({ result: 'pass', score_pct: 100, failed: [] });
    const some = scoreChecklist(items, answers({ a: { answer: 'yes', photos: 0 }, b: { answer: 'no', photos: 0 }, c: { answer: 'yes', photos: 0 }, d: { answer: 'na', photos: 0 } }));
    expect(some.result).toBe('pass_with_findings');
    expect(some.score_pct).toBe(66.7);
    expect(some.failed.map((i) => i.id)).toEqual(['b']);
    const fail = scoreChecklist(items, answers({ a: { answer: 'no', photos: 0 }, b: { answer: 'na', photos: 0 } }));
    expect(fail).toMatchObject({ result: 'fail', score_pct: 0 });
    expect(scoreChecklist(items, answers({ a: { answer: 'na', photos: 0 } })).score_pct).toBeNull();
    expect(findingRatingOf(items[0])).toBe('major_nonconformity');
    expect(findingRatingOf(items[1])).toBe('minor_nonconformity');
  });
});
