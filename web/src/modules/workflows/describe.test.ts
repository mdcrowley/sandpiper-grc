import { describe, expect, it, vi } from 'vitest';
import { waitsForApproval, type LifecycleMeta } from '../../core/lifecycle';
import { isGroup, type Options, type StepDef } from './data';
import { approverText, makeLabels, routeText, stepQuorumText } from './describe';

// The core's formatting helpers only (the core index needs the build's module list).
vi.mock('../../core', () => ({ formatCurrency: String, formatDate: String, formatNumber: (n: number) => Number(n).toLocaleString('en-US') }));

// Wave 8: words for steps side by side and routes (E14-32), and moves that wait for approval (E14-37).

const options: Options = {
  types: [{ type: 'order', label: 'Work order', plural: 'Work orders', module: 'tickets', restricted: false, fields: [
    { name: 'cost', label: 'Cost', type: 'number', list: null, readOnly: false },
  ] }],
  lookups: {}, roles: [], departments: [], kinds: [], permissions: [],
};
const labels = makeLabels(options, 'order', {});
const unit = (key: string, name: string) => ({ key, name, approvers: { kind: 'users' as const, users: [] }, quorum: 'any' as const, conditions: [], due_hours: null, escalate_to: null });

describe('describing workflows', () => {
  const steps: StepDef[] = [
    { ...unit('triage', 'Triage'), routes: [{ conditions: [{ field: 'cost', op: 'gt', value: 10000 }], to: 'director' }, { conditions: [], to: 'end' }] },
    { ...unit('both', 'Finance and safety'), branches: [unit('f', 'Finance'), unit('s', 'Safety')] },
    unit('director', 'Director'),
  ];

  it('names the route by its condition and target', () => {
    expect(routeText(steps[0].routes![0], steps, labels)).toBe('If Cost is more than 10,000, go to "Director"');
    expect(routeText(steps[0].routes![1], steps, labels)).toBe('Then finish (approved)');
  });

  it('knows a step side by side, and copes with one stored without approvers', () => {
    expect(isGroup(steps[1])).toBe(true);
    expect(isGroup(steps[0])).toBe(false);
    const stored = { ...steps[1], approvers: undefined } as unknown as StepDef;
    expect(approverText(stored.approvers, labels)).toBe('');
    expect(stepQuorumText(stored)).toBe('');
  });
});

describe('moves that wait for approval', () => {
  const lc: LifecycleMeta = { field: 'status', managed: false, blocked: [], required: {}, denied: [], approvals: [['review', 'scheduled']] };
  it('is told by the lifecycle in /api/meta', () => {
    expect(waitsForApproval(lc, 'review', 'scheduled')).toBe(true);
    expect(waitsForApproval(lc, 'draft', 'scheduled')).toBe(false);
    expect(waitsForApproval(lc, 'review', 'review')).toBe(false);
    expect(waitsForApproval({ ...lc, approvals: undefined }, 'review', 'scheduled')).toBe(false);
    expect(waitsForApproval(lc, '', 'scheduled')).toBe(false);
  });
});
