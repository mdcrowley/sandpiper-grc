import { describe, expect, it } from 'vitest';
import type { LifecycleMeta } from './lifecycle';
import { allowedForAll, canMoveTo, editableLifecycle, moveBlockedReason } from './lifecycleMenus';

// E14-31: status menus and buttons offer only the moves the lifecycle allows. Invented values only.

const VALUES = ['open', 'in_repair', 'retired'];
const rules = (over: Partial<LifecycleMeta> = {}): LifecycleMeta => ({
  field: 'status', managed: false, blocked: [['open', 'retired'], ['in_repair', 'open']], required: {}, denied: [], ...over,
});

describe('editableLifecycle', () => {
  it('gives the rules only for their own field, and none when the application sets the status', () => {
    expect(editableLifecycle(rules(), 'status')).toBeDefined();
    expect(editableLifecycle(rules(), 'priority')).toBeUndefined();
    expect(editableLifecycle(rules({ managed: true }), 'status')).toBeUndefined();
    expect(editableLifecycle(undefined, 'status')).toBeUndefined();
  });
});

describe('allowedForAll', () => {
  it('offers every value without rules or for a managed status', () => {
    expect(allowedForAll(undefined, ['open'], VALUES)).toEqual(VALUES);
    expect(allowedForAll(rules({ managed: true }), ['open'], VALUES)).toEqual(VALUES);
  });

  it('offers what one record may move to, keeping its own status', () => {
    expect(allowedForAll(rules(), ['open'], VALUES)).toEqual(['open', 'in_repair']);
    expect(allowedForAll(rules(), ['open', 'open'], VALUES)).toEqual(['open', 'in_repair']);
  });

  it('offers only the statuses every record may move to', () => {
    expect(allowedForAll(rules(), ['open', 'in_repair'], VALUES)).toEqual(['in_repair']);
    expect(allowedForAll(rules(), ['open', 'retired'], VALUES)).toEqual(['open', 'in_repair']);
  });

  it('treats an empty status as a new record, and an unknown one as free to move', () => {
    expect(allowedForAll(rules({ blocked: [['', 'retired']] }), [null, undefined], VALUES)).toEqual(['open', 'in_repair']);
    expect(allowedForAll(rules(), ['gone_from_list'], VALUES)).toEqual(VALUES);
  });

  it('leaves out the statuses this person may not set, even one a record already holds', () => {
    expect(allowedForAll(rules({ denied: ['in_repair'] }), ['in_repair'], VALUES)).toEqual(['retired']);
    expect(allowedForAll(rules({ denied: ['in_repair'] }), ['open', 'in_repair'], VALUES)).toEqual([]);
  });
});

describe('canMoveTo and moveBlockedReason', () => {
  it('follows the blocked moves and the denied statuses', () => {
    expect(canMoveTo(rules(), 'open', 'in_repair', VALUES)).toBe(true);
    expect(canMoveTo(rules(), 'open', 'retired', VALUES)).toBe(false);
    expect(canMoveTo(rules(), 'open', 'retired')).toBe(false);
    expect(canMoveTo(rules({ denied: ['in_repair'] }), 'open', 'in_repair', VALUES)).toBe(false);
    expect(canMoveTo(rules(), 'open', 'open', VALUES)).toBe(true);
    expect(canMoveTo(undefined, 'open', 'retired', VALUES)).toBe(true);
    expect(canMoveTo(rules({ managed: true }), 'open', 'retired', VALUES)).toBe(true);
  });

  it('says why in plain words, and nothing when the move is allowed', () => {
    expect(moveBlockedReason(rules(), 'open', 'in_repair', 'In repair', VALUES)).toBe('');
    expect(moveBlockedReason(rules(), 'open', 'retired', 'Retired', VALUES)).toMatch(/does not allow a move to Retired from the current status/);
    expect(moveBlockedReason(rules({ denied: ['retired'] }), 'in_repair', 'retired', 'Retired', VALUES)).toMatch(/may not set the status to Retired/);
    expect(moveBlockedReason(rules({ blocked: [['', 'retired']] }), '', 'retired', 'Retired', VALUES)).toMatch(/new record to start as Retired/);
  });
});
