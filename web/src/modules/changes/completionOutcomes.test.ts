import { describe, expect, it } from 'vitest';
import { completionOutcomes } from './outcomes';

// The Complete dialog offered "Canceled", which the server refuses on completion (docs review F7):
// only the Cancel change action sets it.
describe('the outcomes offered when completing a change', () => {
  it('leaves out Canceled and keeps every other value, including ones an administrator added', () => {
    const list = ['successful', 'successful_with_issues', 'failed', 'backed_out', 'cancelled', 'partly_done'].map((value) => ({ value }));
    expect(completionOutcomes(list)).toEqual(['successful', 'successful_with_issues', 'failed', 'backed_out', 'partly_done']);
  });
});
