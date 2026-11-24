// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byText, click, render, reply, textOf, typeInto, waitFor, type Call, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';
import type { Row } from '../../core';
import type { Gate, ProjectGates, ProjectSettings } from './types';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { GatesProvider } = await import('./gatesContext');
const { GateTab } = await import('./GateTab');
const { ScoringTab } = await import('./ScoringTab');

// E40-12: the project pages' own logic: the Gate tab (what blocks approval, checking a checklist
// item, waiving a required document with a reason, asking for approval through the workflow, a
// decided gate shown read-only) and the Scoring tab's rendered score. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
// happy-dom has no font loading; Mantine's growing text boxes listen for it.
beforeAll(() => {
  const doc = document as unknown as { fonts?: unknown };
  if (!doc.fonts) doc.fonts = { addEventListener: () => undefined, removeEventListener: () => undefined };
});

const META: Meta = {
  ...GIZMO_META,
  lookups: {
    ...GIZMO_META.lookups,
    project_stage: [
      { value: 'idea', label: 'Idea', color: 'gray', sort: 10 },
      { value: 'planning', label: 'Planning', color: 'blue', sort: 20 },
      { value: 'delivery', label: 'Delivery', color: 'green', sort: 30 },
    ],
    project_gate_status: [
      { value: 'open', label: 'Open', color: 'blue', sort: 10 },
      { value: 'approved', label: 'Approved', color: 'green', sort: 20 },
    ],
    project_tier: [
      { value: 'tier1', label: 'Tier 1', color: 'red', sort: 10 },
      { value: 'tier2', label: 'Tier 2', color: 'amber', sort: 20 },
    ],
  },
};

function gate(patch: Partial<Gate> = {}): Gate {
  return {
    id: 'g2', gate_key: 'plan', name: 'Planning approval', from_stage: 'planning', to_stage: 'delivery', status: 'open',
    decided_by_name: null, decided_on: null, requires_certificate: false,
    items: [
      { id: 'i1', label: 'Budget confirmed', checked: true, checked_by_name: 'Pat Example', checked_at: '2026-11-02T15:00:00Z', note: null, evidence_ref: null },
      { id: 'i2', label: 'Depot access plan agreed', checked: false, checked_by_name: null, checked_at: null, note: null, evidence_ref: null },
    ],
    decisions: [],
    documents: [
      { name: 'Business case', required: true, received: false, reference: '' },
      { name: 'Vendor quote', required: false, received: true, reference: 'Shared drive / quotes' },
    ],
    approvers: { tier1: ['Chief executive'], tier2: ['Director of operations'] },
    approvers_for_tier: ['Director of operations'],
    total: 2, checked: 1, outstanding: ['Depot access plan agreed'], missing_documents: ['Business case'],
    blockers: [{ kind: 'checklist', label: 'Depot access plan agreed' }, { kind: 'document', label: 'Business case' }],
    is_current: true, can_approve: false, wants_change: false, change_available: false, change: null,
    approval: { workflow_id: null, workflow_name: null, running: false, last_status: null, last_finished_at: null, can_request: false },
    ...patch,
  };
}

function gates(list: Gate[], current: string | null = 'g2'): ProjectGates {
  return {
    project_id: 'p1', stage: 'planning', status: 'active', tier: 'tier2', stages: [], definitions: [],
    gates: list, current_gate_id: current, rollback: null,
  };
}

const page = () => document.body;

function gateTab(answer: () => unknown, calls: Call[] = [], opts: { route?: string; permissions?: string[]; onChanged?: () => void } = {}) {
  const record = (c: Call) => { calls.push(c); return { ok: true }; };
  const tab = h(GateTab, { projectId: 'p1', onChanged: opts.onChanged ?? (() => undefined) });
  return render(h(GatesProvider, { projectId: 'p1', children: tab }), {
    meta: META, route: opts.route ?? '/projects/p1?tab=gate', permissions: opts.permissions,
    handlers: {
      'GET /api/projects/p1/gates': answer,
      'PATCH /api/projects/p1/gates/g2/items/i2': record,
      'POST /api/projects/p1/gates/g2/documents/0/waive': record,
      'POST /api/projects/p1/gates/g2/request-approval': record,
    },
  });
}

describe('the Gate tab', () => {
  it('says exactly what blocks approval, with the checklist, the documents and the approvers for the tier', async () => {
    ui = await gateTab(() => gates([gate()]));
    await waitFor(() => expect(textOf(ui!.container)).toContain('Approval is blocked: 1 checklist item to do, 1 required document missing'));
    expect(textOf(ui.container)).toContain('To approve this gate, check the outstanding checklist items, then mark each required document as received');
    expect(textOf(ui.container)).toContain('The project stays in Planning until then.');
    expect(textOf(ui.container)).toContain('1 still to do');
    expect(textOf(ui.container)).toContain('Checked by Pat Example');
    const docs = [...ui.container.querySelectorAll('.prj-doc')].map((d) => textOf(d));
    expect(docs[0]).toContain('Business case');
    expect(docs[0]).toContain('Missing');
    expect(docs[1]).toContain('Received');
    expect(textOf(ui.container)).toContain('Approvers for Tier 2');
    expect(textOf(ui.container)).toContain('Director of operations');
    expect(textOf(ui.container)).toContain('No decision recorded yet');
    expect(byText(ui.container, 'button', 'Ask for approval')).toBeNull();
  });

  it('checks a checklist item and reads the gates again', async () => {
    const calls: Call[] = [];
    const onChanged = vi.fn();
    let reads = 0;
    ui = await gateTab(() => { reads += 1; return gates([gate()]); }, calls, { onChanged });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Depot access plan agreed'));
    const box = [...ui.container.querySelectorAll('.prj-check')].find((li) => textOf(li).includes('Depot access plan agreed'))!.querySelector('input[type="checkbox"]');
    const before = reads;
    await click(box);
    await waitFor(() => expect(calls.length).toBe(1));
    expect([calls[0].method, calls[0].path, calls[0].body]).toEqual(['PATCH', '/api/projects/p1/gates/g2/items/i2', { checked: true }]);
    await waitFor(() => expect(reads).toBeGreaterThan(before));
    expect(onChanged).toHaveBeenCalled();
  });

  it('waives a required document only with a reason', async () => {
    const calls: Call[] = [];
    ui = await gateTab(() => gates([gate()]), calls);
    await waitFor(() => expect(byText(ui!.container, 'button', 'Waive')).not.toBeNull());
    await click(byText(ui.container, 'button', 'Waive'));
    const submit = () => [...page().querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => textOf(b) === 'Waive document');
    await waitFor(() => expect(submit()).toBeTruthy());
    expect(textOf(page())).toContain('Waive: Business case');
    await click(submit());
    await waitFor(() => expect(textOf(page())).toContain('Say why this document is not needed.'));
    expect(calls).toEqual([]);

    const label = [...page().querySelectorAll('label')].find((l) => textOf(l).startsWith('Reason'))!;
    await typeInto(document.getElementById(label.getAttribute('for')!), 'Covered by the program business case.');
    await click(submit());
    await waitFor(() => expect(calls.length).toBe(1));
    expect([calls[0].method, calls[0].path, calls[0].body]).toEqual(['POST', '/api/projects/p1/gates/g2/documents/0/waive', { reason: 'Covered by the program business case.' }]);
  });

  it('asks for approval through the workflow when the gate is ready; recording by hand is for an administrator', async () => {
    const calls: Call[] = [];
    const ready = gate({
      blockers: [], checked: 2, outstanding: [], missing_documents: [],
      items: gate().items.map((i) => ({ ...i, checked: true, checked_by_name: 'Pat Example' })),
      approval: { workflow_id: 'wf1', workflow_name: 'Capital gate approval', running: false, last_status: null, last_finished_at: null, can_request: true },
    });
    ui = await gateTab(() => gates([ready]), calls, { permissions: ['projects.view', 'projects.edit', 'projects.approve'] });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Ready for a decision'));
    expect(textOf(ui.container)).toContain('Ask for approval through "Capital gate approval" to move the project to Delivery.');
    expect(textOf(ui.container)).toContain('Every item is done');
    expect(byText(ui.container, 'button', 'Record decision')).toBeNull();
    await click(byText(ui.container, 'button', 'Ask for approval'));
    await waitFor(() => expect(calls.length).toBe(1));
    expect([calls[0].method, calls[0].path]).toEqual(['POST', '/api/projects/p1/gates/g2/request-approval']);
  });

  it('shows an approved earlier gate read-only when it is chosen in the address', async () => {
    const earlier = gate({
      id: 'g1', gate_key: 'idea', name: 'Idea approval', from_stage: 'idea', to_stage: 'planning', status: 'approved', is_current: false,
      blockers: [], checked: 2, items: gate().items.map((i) => ({ ...i, checked: true, checked_by_name: 'Pat Example' })),
      decisions: [{ id: 'd1', decision: 'approved', approver_name: 'Sam Placeholder', approver_role: 'Director of operations', decided_on: '2026-09-14', reference: 'MIN-42', notes: null, recorded_by_name: 'Pat Example' }],
    });
    ui = await gateTab(() => gates([earlier, gate()]), [], { route: '/projects/p1?tab=gate&gate=g1' });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Approved by Sam Placeholder, Director of operations'));
    expect(textOf(ui.container)).toContain('Reference: MIN-42');
    expect(ui.container.querySelectorAll('.prj-check input[type="checkbox"]').length).toBe(0);
    expect(byText(ui.container, 'button', 'Waive')).toBeNull();
    expect(textOf(ui.container)).not.toContain('Approval is blocked');
  });

  it('explains a project with no gates, and a gate list that cannot be read', async () => {
    ui = await gateTab(() => gates([], null));
    await waitFor(() => expect(textOf(ui!.container)).toContain('No gates yet'));
    ui.unmount();
    ui = await gateTab(() => reply(500, { error: { code: 'internal', message: 'Gate service unavailable.' } }));
    await waitFor(() => expect(textOf(ui!.container)).toContain('The gates could not be loaded'));
  });
});

const SETTINGS: ProjectSettings = {
  tiers: { tier3Below: 100000, tier1Above: 1000000 },
  criteria: [
    { key: 'ridership', label: 'Ridership benefit', weight: 3, description: 'More riders served' },
    { key: 'safety', label: 'Safety benefit', weight: 1 },
  ],
  wipLimit: 5, maxScore: 4, intakeOpenTo: 'create', reportIntervalDays: 30,
};

describe('the Scoring tab', () => {
  const scoring = (row: Row, save: (patch: Record<string, unknown>) => Promise<unknown>, settings: () => unknown = () => SETTINGS) =>
    render(h(ScoringTab, { row, save, canEdit: true }), { meta: META, handlers: { 'GET /api/projects/settings': settings } });

  it('shows the saved priority score and each criterion\'s share of it', async () => {
    ui = await scoring({ id: 'p1', scoring: { ridership: 4, safety: 2 } } as Row, vi.fn());
    await waitFor(() => expect(textOf(ui!.container.querySelector('.prj-criteria-total'))).toBe('Priority score87.5 of 100'));
    const lines = [...ui.container.querySelectorAll('.prj-criteria > li')].map((li) => textOf(li));
    expect(lines[0]).toContain('Ridership benefit');
    expect(lines[0]).toContain('75 points × 4/4 = 75');
    expect(lines[1]).toContain('25 points × 2/4 = 12.5');
    expect(textOf(ui.container)).toContain('Used to rank projects in the portfolio.');
    expect((byText(ui.container, 'button', 'Save scores') as HTMLButtonElement).disabled).toBe(true);
  });

  it('previews a changed score and saves the scores', async () => {
    const save = vi.fn(async () => ({}));
    ui = await scoring({ id: 'p1', scoring: { ridership: 4, safety: 2 } } as Row, save);
    await waitFor(() => expect(ui!.container.querySelectorAll('.prj-criteria > li').length).toBe(2));
    const first = ui.container.querySelectorAll('.prj-criteria > li')[0];
    const option = [...first.querySelectorAll('label')].find((l) => textOf(l) === '2')!;
    await click(document.getElementById(option.getAttribute('for')!));
    await waitFor(() => expect(textOf(ui!.container.querySelector('.prj-criteria-total'))).toBe('Priority score50 of 100'));
    expect(textOf(ui.container)).toContain('Preview: not saved yet.');
    await click(byText(ui.container, 'button', 'Save scores'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ scoring: { ridership: 2, safety: 2 } });
  });

  it('shows the error when the criteria cannot be read', async () => {
    ui = await scoring({ id: 'p1', scoring: {} } as Row, vi.fn(), () => reply(500, { error: { code: 'internal', message: 'Settings unavailable.' } }));
    await waitFor(() => expect(textOf(ui!.container)).toContain('The scoring criteria could not be loaded'));
  });
});
