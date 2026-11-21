import { describe, expect, it } from 'vitest';
import { allowedStatuses, requiredFor } from '../../core/lifecycle';
import { describeMoves, NEW, unreachable } from './data';

const values = ['open', 'working', 'done', 'canceled'];

describe('lifecycle helpers', () => {
  it('lists the moves each status allows, a new record first', () => {
    const moves = describeMoves(values, [[NEW, 'done'], ['open', 'done'], ['done', 'open']]);
    expect(moves.get(NEW)).toEqual(['open', 'working', 'canceled']);
    expect(moves.get('open')).toEqual(['working', 'canceled']);
    expect(moves.get('done')).toEqual(['working', 'canceled']);
  });

  it('finds statuses a new record can never reach', () => {
    expect(unreachable(values, [])).toEqual([]);
    expect(unreachable(values, [[NEW, 'done'], ['open', 'done'], ['working', 'done'], ['canceled', 'done']])).toEqual(['done']);
    // Reachable through another status.
    expect(unreachable(values, [[NEW, 'done']])).toEqual([]);
  });

  it('offers a form only the statuses a record may move to, keeping its own', () => {
    const lc = { field: 'status', managed: false, blocked: [['open', 'done'], [NEW, 'done']] as [string, string][], required: { done: ['notes'] }, denied: ['canceled'] };
    expect(allowedStatuses(undefined, 'open', values)).toEqual(values);
    expect(allowedStatuses(lc, 'open', values)).toEqual(['open', 'working']);
    expect(allowedStatuses(lc, '', values)).toEqual(['open', 'working']);
    expect(allowedStatuses(lc, 'canceled', values)).toEqual(['open', 'working', 'done', 'canceled']);
    expect(allowedStatuses(lc, 'retired', values)).toEqual(['open', 'working', 'done']); // a status no longer on the list
    expect(requiredFor(lc, 'done')).toEqual(['notes']);
    expect(requiredFor(lc, 'open')).toEqual([]);
    expect(requiredFor(undefined, 'done')).toEqual([]);
  });
});
