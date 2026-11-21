import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../../core/module.ts';
import {
  allHold, applicableBranches, checkDefinition, conditionHolds, eligible, groupStatus, isGroup, nextStep, outcomePatch, refusal, required, routeAfter, tally, unitAt,
  type ApprovalUnit, type DefinitionContext, type StepDef,
} from './engine.ts';

// E14-06: the workflow engine's rules on their own. Invented data only.

const FIELDS: Record<string, FieldDef> = {
  title: { label: 'Title', type: 'text', required: true },
  priority: { label: 'Priority', type: 'lookup', list: 'prio' },
  cost: { label: 'Cost', type: 'currency' },
  needed_by: { label: 'Needed by', type: 'date' },
  owner_id: { label: 'Owner', type: 'user' },
  urgent: { label: 'Urgent', type: 'boolean' },
  department: { label: 'Department', type: 'text' },
  status: { label: 'Status', type: 'lookup', list: 'st' },
  ref: { label: 'Reference', type: 'text', readOnly: true },
};
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

const step = (over: Partial<StepDef> = {}): StepDef => ({
  key: 's', name: 'Step', approvers: { kind: 'users', users: [U1] }, quorum: 'any', conditions: [], due_hours: null, escalate_to: null, ...over,
});

describe('conditions on record fields', () => {
  const row = { title: 'Replace depot radio', priority: 'high', cost: 1500, needed_by: '2026-12-01', owner_id: U1, urgent: true, department: 'Rail Operations', custom: { lane: 'north' } };

  it('compares lists, numbers, dates, text and booleans by their type', () => {
    expect(conditionHolds({ field: 'priority', op: 'eq', value: 'high' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'priority', op: 'ne', value: 'high' }, row, FIELDS)).toBe(false);
    expect(conditionHolds({ field: 'priority', op: 'in', value: ['low', 'high'] }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'cost', op: 'gt', value: 1000 }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'cost', op: 'gt', value: '1500' }, row, FIELDS)).toBe(false);
    expect(conditionHolds({ field: 'cost', op: 'gte', value: '1500' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'cost', op: 'lt', value: 2000 }, { ...row, cost: '1999.99' }, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'needed_by', op: 'lte', value: '2026-12-01' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'needed_by', op: 'lt', value: '2026-11-30' }, row, FIELDS)).toBe(false);
    expect(conditionHolds({ field: 'department', op: 'eq', value: ' rail operations ' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'urgent', op: 'eq', value: 'yes' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'urgent', op: 'set' }, { ...row, urgent: false }, FIELDS)).toBe(false);
  });

  it('treats empty values and unknown fields safely', () => {
    expect(conditionHolds({ field: 'cost', op: 'gt', value: 1 }, { ...row, cost: null }, FIELDS)).toBe(false);
    expect(conditionHolds({ field: 'cost', op: 'empty' }, { ...row, cost: null }, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'owner_id', op: 'set' }, row, FIELDS)).toBe(true);
    expect(conditionHolds({ field: 'nothing', op: 'empty' }, row, FIELDS)).toBe(false);
    expect(conditionHolds({ field: 'cf_lane', op: 'eq', value: 'north' }, row, { ...FIELDS, cf_lane: { label: 'Lane', type: 'text' } })).toBe(true);
  });

  it('needs every condition, and an empty list always holds', () => {
    expect(allHold([], row, FIELDS)).toBe(true);
    expect(allHold([{ field: 'priority', op: 'eq', value: 'high' }, { field: 'cost', op: 'gt', value: 5000 }], row, FIELDS)).toBe(false);
  });
});

describe('steps in order', () => {
  const steps = [
    step({ key: 'a' }),
    step({ key: 'b', conditions: [{ field: 'cost', op: 'gt', value: 10_000 }] }),
    step({ key: 'c', conditions: [{ field: 'priority', op: 'eq', value: 'high' }] }),
  ];
  it('goes to the next step whose conditions hold, skipping the others', () => {
    expect(nextStep(steps, 0, { cost: 50, priority: 'high' }, FIELDS)).toEqual({ next: 0, skipped: [] });
    expect(nextStep(steps, 1, { cost: 50, priority: 'high' }, FIELDS)).toEqual({ next: 2, skipped: [1] });
    expect(nextStep(steps, 1, { cost: 50, priority: 'low' }, FIELDS)).toEqual({ next: null, skipped: [1, 2] });
    expect(nextStep(steps, 3, {}, FIELDS)).toEqual({ next: null, skipped: [] });
  });
});

describe('who decides, and how many', () => {
  it('never lets the requester approve their own request, and names each person once', () => {
    expect(eligible([U1, U2, U1, null, U3], U2)).toEqual([U1, U3]);
    expect(eligible([U1, U2], null, (id) => id !== U1)).toEqual([U2]);
  });

  it('works out the quorum from any, all or a number', () => {
    expect(required('any', 4)).toBe(1);
    expect(required('all', 3)).toBe(3);
    expect(required(2, 3)).toBe(2);
    expect(required(5, 3)).toBe(3);
    expect(required('all', 0)).toBe(1);
  });

  it('approves on enough approvals and rejects on any rejection', () => {
    expect(tally([{ decision: 'approved' }], 2)).toBe('pending');
    expect(tally([{ decision: 'approved' }, { decision: 'approved' }], 2)).toBe('approved');
    expect(tally([{ decision: 'approved' }, { decision: 'rejected' }], 1)).toBe('rejected');
  });

  it('refuses the requester, people not named, second decisions and finished steps', () => {
    const s = { status: 'pending', approvers: [U1, U2] };
    const running = { status: 'running', requested_by: U3 };
    expect(refusal(s, running, U1, false)).toBeNull();
    expect(refusal(s, { status: 'running', requested_by: U1 }, U1, false)).toMatch(/someone else/);
    expect(refusal(s, running, U3, false)).toMatch(/someone else/);
    expect(refusal({ ...s, approvers: [U2] }, running, U1, false)).toMatch(/not one of the approvers/);
    expect(refusal(s, running, U1, true)).toMatch(/already decided/);
    expect(refusal({ ...s, status: 'approved' }, running, U1, false)).toMatch(/not waiting/);
    expect(refusal(s, { ...running, status: 'rejected' }, U1, false)).toMatch(/finished/);
  });
});

describe('outcome values', () => {
  it('fills in today, the last approver and the requester', () => {
    const patch = outcomePatch([
      { field: 'needed_by', value: 'today' }, { field: 'owner_id', value: 'approver' }, { field: 'status', value: 'approved' },
      { field: 'urgent', value: 'false' }, { field: 'cost', value: '12.5' }, { field: 'gone', value: 'x' },
    ], FIELDS, { today: '2026-11-19', approver: U2, requester: U3 });
    expect(patch).toEqual({ needed_by: '2026-11-19', owner_id: U2, status: 'approved', urgent: false, cost: 12.5 });
    expect(outcomePatch([{ field: 'owner_id', value: 'requester' }], FIELDS, { today: '', approver: null, requester: U3 })).toEqual({ owner_id: U3 });
  });
});

describe('checking a definition', () => {
  const c: DefinitionContext = {
    types: { request: { fields: FIELDS } },
    lookup: (list) => (list === 'prio' ? ['low', 'high'] : list === 'st' ? ['new', 'submitted', 'approved', 'rejected'] : []),
    roles: ['agent', 'approver'],
    users: [U1, U2],
  };
  const good = {
    record_type: 'request', name: 'Purchase approval', trigger: 'status', trigger_field: 'status', trigger_value: 'submitted',
    conditions: [{ field: 'priority', op: 'in', value: ['high'] }],
    steps: [
      { name: 'Manager', approvers: { kind: 'field', field: 'owner_id' } },
      { name: 'Finance', approvers: { kind: 'users', users: [U1, U2] }, quorum: 'all', due_hours: 48, escalate_to: { users: [U2] }, conditions: [{ field: 'cost', op: 'gt', value: 1000 }] },
      { name: 'Head', approvers: { kind: 'department_head', from: 'field', field: 'department' }, quorum: 1 },
    ],
    on_approve: [{ field: 'status', value: 'approved' }, { field: 'needed_by', value: 'today' }],
    on_reject: [{ field: 'status', value: 'rejected' }],
  };

  it('accepts a complete definition and cleans it', () => {
    const { def, errors } = checkDefinition(good, c);
    expect(errors).toBeUndefined();
    expect(def!.steps.map((s) => [s.key, s.quorum])).toEqual([['step-1', 'any'], ['step-2', 'all'], ['step-3', 'any']]);
    expect(def!.steps[1].escalate_to).toEqual({ users: [U2], role: null });
    expect(def!.active).toBe(true);
  });

  it('names each problem by field', () => {
    const { errors } = checkDefinition({
      ...good, name: ' ', trigger_value: 'nope',
      conditions: [{ field: 'title', op: 'gt', value: 'x' }],
      steps: [
        { name: '', approvers: { kind: 'users', users: [U3] } },
        { name: 'B', approvers: { kind: 'role', role: 'nobody' }, quorum: 50, due_hours: -1 },
        { name: 'C', approvers: { kind: 'field', field: 'title' }, escalate_to: { users: [U1] } },
      ],
      on_approve: [{ field: 'ref', value: 'X' }, { field: 'status', value: 'nope' }],
    }, c);
    expect(Object.keys(errors!).sort()).toEqual([
      'conditions.0', 'name', 'on_approve.0', 'on_approve.1', 'steps.0.approvers', 'steps.0.name',
      'steps.1.approvers', 'steps.1.due_hours', 'steps.1.quorum', 'steps.2.approvers', 'steps.2.escalate_to', 'trigger_value',
    ]);
    expect(checkDefinition({ ...good, steps: [] }, c).errors!.steps).toMatch(/at least one/);
    expect(checkDefinition({ ...good, record_type: 'other' }, c).errors!.record_type).toBeTruthy();
  });
});

describe('steps side by side and routes (E14-32)', () => {
  const c: DefinitionContext = {
    types: { request: { fields: FIELDS } }, lookup: (list) => (list === 'prio' ? ['low', 'high'] : []), roles: ['agent'], users: [U1, U2, U3],
  };
  const base = { record_type: 'request', name: 'Purchase', trigger: 'manual' };

  it('leaves a definition written before unchanged (no branches or routes appear)', () => {
    const old = { ...base, steps: [{ key: 'one', name: 'One', approvers: { kind: 'users', users: [U1] }, quorum: 'any', conditions: [], due_hours: null, escalate_to: null }] };
    const { def } = checkDefinition(old, c);
    expect(def!.steps).toEqual(old.steps);
  });

  it('cleans branches and routes, and checks that routes only go forward', () => {
    const { def, errors } = checkDefinition({
      ...base,
      steps: [
        { key: 'both', name: 'Finance and safety', branches: [
          { name: 'Finance', approvers: { kind: 'users', users: [U1] } },
          { name: 'Safety', approvers: { kind: 'users', users: [U2] }, quorum: 'all', conditions: [{ field: 'urgent', op: 'set' }] },
        ], routes: [{ conditions: [{ field: 'cost', op: 'gt', value: 5000 }], to: 'board' }] },
        { key: 'manager', name: 'Manager', approvers: { kind: 'users', users: [U3] }, routes: [{ conditions: [], to: 'end' }] },
        { key: 'board', name: 'Board', approvers: { kind: 'users', users: [U1] } },
      ],
    }, c);
    expect(errors).toBeUndefined();
    expect(def!.steps[0].approvers).toBeUndefined();
    expect(def!.steps[0].branches!.map((b) => [b.key, b.name, b.quorum])).toEqual([['both-a', 'Finance', 'any'], ['both-b', 'Safety', 'all']]);
    expect(def!.steps[0].routes).toEqual([{ conditions: [{ field: 'cost', op: 'gt', value: 5000 }], to: 'board' }]);
    expect(def!.steps[2]).not.toHaveProperty('routes');

    const bad = checkDefinition({
      ...base,
      steps: [
        { key: 'a', name: 'A', branches: [{ name: 'Only one', approvers: { kind: 'users', users: [U1] } }] },
        { key: 'b', name: 'B', approvers: { kind: 'users', users: [U1] }, routes: [{ to: 'a' }, { to: 'nowhere' }, { to: 'b' }] },
      ],
    }, c).errors!;
    expect(bad['steps.0.branches']).toMatch(/at least two/);
    expect(bad['steps.1.routes.0']).toMatch(/later step/);
    expect(bad['steps.1.routes.1']).toMatch(/later step, or the end/);
    expect(bad['steps.1.routes.2']).toMatch(/later step/);
  });

  const steps: StepDef[] = [
    { ...step({ key: 'a', name: 'A' }), routes: [{ conditions: [{ field: 'cost', op: 'gt', value: 1000 }], to: 'c' }, { conditions: [{ field: 'urgent', op: 'set' }], to: 'end' }] },
    step({ key: 'b', name: 'B' }),
    { key: 'c', name: 'C', quorum: 'any', conditions: [], due_hours: null, escalate_to: null, branches: [step({ key: 'c1', name: 'C1' }) as ApprovalUnit, step({ key: 'c2', name: 'C2', conditions: [{ field: 'priority', op: 'eq', value: 'high' }] }) as ApprovalUnit] },
  ];

  it('chooses the route by the first condition that holds, else the next step', () => {
    expect(routeAfter(steps, 0, { cost: 5000 }, FIELDS)).toBe(2);
    expect(routeAfter(steps, 0, { cost: 10, urgent: true }, FIELDS)).toBe(3); // the end
    expect(routeAfter(steps, 0, { cost: 10 }, FIELDS)).toBe(1);
    expect(routeAfter(steps, 1, { cost: 5000 }, FIELDS)).toBe(2);
    // A route that points backwards (edited by hand) is ignored.
    expect(routeAfter([{ ...step({ key: 'x' }) }, { ...step({ key: 'y' }), routes: [{ conditions: [], to: 'x' }] }], 1, {}, FIELDS)).toBe(2);
  });

  it('starts the branches whose conditions hold, and reads a group from its branches', () => {
    expect(isGroup(steps[2])).toBe(true);
    expect(isGroup(steps[0])).toBe(false);
    expect(applicableBranches(steps[2], { priority: 'low' }, FIELDS)).toEqual([0]);
    expect(applicableBranches(steps[2], { priority: 'high' }, FIELDS)).toEqual([0, 1]);
    expect(applicableBranches(steps[0], {}, FIELDS)).toEqual([null]);
    expect(unitAt(steps, 2, 1)!.name).toBe('C2');
    expect(unitAt(steps, 0, null)!.name).toBe('A');
    expect(unitAt(steps, 2, null)).toBeNull();
    expect(groupStatus(['approved', 'pending'])).toBe('pending');
    expect(groupStatus(['approved', 'skipped'])).toBe('approved');
    expect(groupStatus(['canceled', 'rejected'])).toBe('rejected');
    expect(groupStatus(['skipped', 'skipped'])).toBe('skipped');
  });
});
