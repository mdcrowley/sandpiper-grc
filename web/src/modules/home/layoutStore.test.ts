import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT, parseLayout, resolveOrder } from './layoutStore';

describe('Overview layout', () => {
  it('reads a stored layout and ignores anything malformed', () => {
    expect(parseLayout({ order: ['b', 'a', 'a', 3, ''], hidden: ['c'] })).toEqual({ order: ['b', 'a'], hidden: ['c'] });
    expect(parseLayout(null)).toBe(EMPTY_LAYOUT);
    expect(parseLayout(['a'])).toBe(EMPTY_LAYOUT);
    expect(parseLayout({ order: 'a' })).toEqual({ order: [], hidden: [] });
  });

  it('keeps the chosen order, drops widgets that no longer exist and slots new ones in at their default place', () => {
    const defaults = ['tickets', 'actions', 'approvals', 'training'];
    expect(resolveOrder([], defaults)).toEqual(defaults);
    expect(resolveOrder(['training', 'tickets', 'gone'], defaults)).toEqual(['training', 'tickets', 'actions', 'approvals']);
    expect(resolveOrder(['approvals'], defaults)).toEqual(['tickets', 'approvals', 'actions', 'training'].sort((a, b) => (
      // tickets has no earlier default, so it goes first; actions follows tickets; training follows approvals
      ['tickets', 'actions', 'approvals', 'training'].indexOf(a) - ['tickets', 'actions', 'approvals', 'training'].indexOf(b)
    )));
  });
});
