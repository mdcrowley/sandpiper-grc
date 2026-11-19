import { describe, expect, it } from 'vitest';
import { knownLabel, rememberLabel } from './labels';

describe('remembered record and people labels', () => {
  it('keeps a label by kind and id, ignoring blanks', () => {
    rememberLabel('ticket', 't1', 'TCK-1 Printer jam');
    rememberLabel('user', 'u1', '');
    rememberLabel('user', null, 'Nobody');
    expect(knownLabel('ticket', 't1')).toBe('TCK-1 Printer jam');
    expect(knownLabel('user', 't1')).toBeUndefined();
    expect(knownLabel('user', 'u1')).toBeUndefined();
  });
});
