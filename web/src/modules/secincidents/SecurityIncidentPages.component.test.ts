// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byLabel, byText, click, render, reply, textOf, typeInto, waitFor, type Call, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';
import type { Clock, ClocksResult } from './types';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { ClocksRail } = await import('./Clocks');
const { DeclareIncident } = await import('./DeclareIncident');

// E40-12: the security incident pages' own logic: the notification clocks (most urgent first, the
// headline, recording a notification, marking one not required with a reason for the log,
// reopening) and the declare flow (a title first, the live preview of the notifications the
// answers require, and the status the lifecycle gives a declared incident). Invented data only.

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
    security_incident_severity: [
      { value: 'minor', label: 'Minor', color: 'green', sort: 10 },
      { value: 'moderate', label: 'Moderate', color: 'amber', sort: 20 },
      { value: 'major', label: 'Major', color: 'red', sort: 30 },
    ],
    security_incident_scenario: [{ value: 'ransomware', label: 'Ransomware', color: 'red', sort: 10 }],
  },
};

const HOUR = 3_600_000;
const page = () => document.body;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function clock(id: string, party: string, patch: Partial<Clock>): Clock {
  return {
    task_id: id, ref: null, incident_id: 'i1', rule_id: `rule-${id}`, party, title: `Notify ${party}`, required: true,
    deadline_hours: 24, guidance: null, due_at: iso(10 * HOUR), status: 'pending', state: 'green', seconds_remaining: null,
    overdue: false, late: false, notified_who: null, notified_how: null, notified_at: null, reference_received: null,
    completed_at: null, completed_by_name: null, amber_at: null, ...patch,
  };
}

function clocksAnswer(clocks: Clock[]): ClocksResult {
  return {
    now: iso(0), amber_fraction: 0.25, clocks,
    incident: { id: 'i1', ref: 'SI-00004', title: 'Ransom note on the scheduling server', discovered_at: iso(-12 * HOUR), declared_at: iso(-11 * HOUR) },
  };
}

const CLOCKS = () => [
  clock('t2', 'Board chair', { due_at: iso(30 * HOUR), deadline_hours: 42 }),
  clock('t4', 'Insurance carrier', { status: 'not_required', state: 'not_required', required: false }),
  clock('t1', 'Regional oversight desk', { due_at: iso(-2 * HOUR), deadline_hours: 10, state: 'red', overdue: true }),
  clock('t3', 'Data protection contact', {
    status: 'done', state: 'met', due_at: iso(-1 * HOUR), notified_at: iso(-3 * HOUR), notified_who: 'Duty officer Lee Sample',
    notified_how: 'Phone', reference_received: 'CASE-881', completed_by_name: 'Pat Example', completed_at: iso(-3 * HOUR),
  }),
];

function rail(clocks: Clock[] | (() => unknown), calls: Call[] = [], props: Partial<{ declared: boolean; canEdit: boolean; onChanged: () => void }> = {}) {
  return render(h(ClocksRail, { incidentId: 'i1', declared: true, version: '1', canEdit: true, onChanged: () => undefined, ...props }), {
    meta: META,
    handlers: {
      'GET /api/security-incidents/i1/clocks': typeof clocks === 'function' ? clocks : () => clocksAnswer(clocks),
      'PATCH /api/notification-tasks/t1': (c) => { calls.push(c); return { ok: true }; },
      'PATCH /api/notification-tasks/t2': (c) => { calls.push(c); return { ok: true }; },
      'PATCH /api/notification-tasks/t4': (c) => { calls.push(c); return { ok: true }; },
      'POST /api/security-incidents/i1/log': (c) => { calls.push(c); return { id: 'log1' }; },
    },
  });
}

const cards = () => [...ui!.container.querySelectorAll<HTMLElement>('li.si-clock')];
const card = (party: string) => cards().find((c) => textOf(c.querySelector('.si-clock-party')) === party)!;
const modalSubmit = (label: string) => [...page().querySelectorAll<HTMLButtonElement>('form button[type="submit"]')].find((b) => textOf(b) === label);
const field = (label: string) => {
  const l = [...page().querySelectorAll('form label')].find((x) => textOf(x).replace(/\s*\*$/, '') === label);
  return document.getElementById(l?.getAttribute('for') ?? '') as HTMLInputElement | null;
};

describe('the notification clocks', () => {
  it('puts the overdue clock first and leads with it, then the open, notified and skipped ones', async () => {
    ui = await rail(CLOCKS());
    await waitFor(() => expect(cards().length).toBe(4));
    expect(cards().map((c) => textOf(c.querySelector('.si-clock-party')))).toEqual(
      ['Regional oversight desk', 'Board chair', 'Data protection contact', 'Insurance carrier'],
    );
    const headline = textOf(ui.container.querySelector('.si-next'));
    expect(headline).toContain('Notification overdue');
    expect(headline).toContain('Regional oversight desk');
    expect(headline).toContain('2 notifications still to make');
    expect(ui.container.querySelector('.si-next')?.classList.contains('si-next-red')).toBe(true);
    expect(textOf(card('Regional oversight desk'))).toContain('Overdue by');
    expect(textOf(card('Board chair'))).toContain('left');
    expect(textOf(card('Board chair'))).toContain('42 hours from discovery');
    expect(textOf(card('Data protection contact'))).toContain('Notified in time');
    expect(textOf(card('Data protection contact'))).toContain('Duty officer Lee Sample');
    expect(textOf(card('Data protection contact'))).toContain('CASE-881');
    expect(textOf(card('Insurance carrier'))).toContain('Not required for this incident.');
  });

  it('records a notification only with who, how and when, then reads the clocks again', async () => {
    const calls: Call[] = [];
    const onChanged = vi.fn();
    let reads = 0;
    ui = await rail(() => { reads += 1; return clocksAnswer(CLOCKS()); }, calls, { onChanged });
    await waitFor(() => expect(cards().length).toBe(4));
    await click(byText(card('Board chair'), 'button', 'Record notification'));
    await waitFor(() => expect(modalSubmit('Record notification')).toBeTruthy());
    expect(textOf(page())).toContain('Record notification: Board chair');

    await click(modalSubmit('Record notification'));
    await waitFor(() => expect(textOf(page())).toContain('Record who was notified.'));
    expect(textOf(page())).toContain('Record how they were notified.');
    expect(calls).toEqual([]);

    await typeInto(field('Who was notified'), 'Chair, by the board secretary');
    await click(byText(page(), 'button.si-quick-chip', 'Email'));
    await waitFor(() => expect(field('How')?.value).toBe('Email'));
    const before = reads;
    await click(modalSubmit('Record notification'));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].path).toBe('/api/notification-tasks/t2');
    const body = calls[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'done', notified_who: 'Chair, by the board secretary', notified_how: 'Email', reference_received: '' });
    expect(Number.isNaN(Date.parse(String(body.notified_at)))).toBe(false);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });

  it('marks a notification not required only with a reason, which goes to the incident log', async () => {
    const calls: Call[] = [];
    ui = await rail(CLOCKS(), calls);
    await waitFor(() => expect(cards().length).toBe(4));
    await click(byText(card('Regional oversight desk'), 'button', 'Not required'));
    await waitFor(() => expect(modalSubmit('Mark not required')).toBeTruthy());
    await click(modalSubmit('Mark not required'));
    await waitFor(() => expect(textOf(page())).toContain('Say why this notification is not required'));
    expect(calls).toEqual([]);

    await typeInto(field('Reason'), 'Below the reporting threshold after review.');
    await click(modalSubmit('Mark not required'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect([calls[0].method, calls[0].path, calls[0].body]).toEqual(['PATCH', '/api/notification-tasks/t1', { status: 'not_required' }]);
    expect([calls[1].method, calls[1].path, calls[1].body]).toEqual(['POST', '/api/security-incidents/i1/log', {
      kind: 'decision', entry: 'Notification to Regional oversight desk marked not required. Reason: Below the reporting threshold after review.',
    }]);
  });

  it('reopens a skipped notification, and shows no buttons to someone who may not edit', async () => {
    const calls: Call[] = [];
    ui = await rail(CLOCKS(), calls);
    await waitFor(() => expect(cards().length).toBe(4));
    await click(byText(card('Insurance carrier'), 'button', 'Reopen'));
    await waitFor(() => expect(calls.length).toBe(1));
    expect([calls[0].method, calls[0].path, calls[0].body]).toEqual(['PATCH', '/api/notification-tasks/t4', { status: 'pending' }]);
    ui.unmount();

    ui = await rail(CLOCKS(), [], { canEdit: false });
    await waitFor(() => expect(cards().length).toBe(4));
    expect(ui.container.querySelectorAll('.si-clock-actions').length).toBe(0);
  });

  it('explains an empty rail before and after the declaration, and shows a load error', async () => {
    ui = await rail([], [], { declared: false });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Clocks start when the incident is declared'));
    ui.unmount();
    ui = await rail([], [], { declared: true });
    await waitFor(() => expect(textOf(ui!.container)).toContain('No notifications required'));
    ui.unmount();
    ui = await rail(() => reply(500, { error: { code: 'internal', message: 'The clocks service is down.' } }));
    await waitFor(() => expect(textOf(ui!.container)).toContain('The clocks could not be loaded'));
  });
});

const QUESTIONS = {
  questions: [
    { key: 'is_cyber_incident', kind: 'flag', value: 'is_cyber_incident', question: 'Is this a cyber incident?', hint: '' },
    { key: 'personal', kind: 'data_kind', value: 'personal_information', question: 'Was personal information involved?', hint: '' },
  ],
  triggers: [],
};

function declare(previews: unknown[], created: unknown[]) {
  return render(h(DeclareIncident), {
    meta: META, route: '/security-incidents/declare',
    handlers: {
      'GET /api/security-incidents/lifecycle': () => ({
        stages: [], phases: [], review_statuses: [], time_zone: 'America/New_York',
        statuses: [
          { value: 'reported', label: 'Reported', color: 'gray', sort: 10, stage: 'reported' },
          { value: 'responding', label: 'Responding', color: 'red', sort: 20, stage: 'declared' },
        ],
      }),
      'GET /api/security-incidents/questions': () => QUESTIONS,
      'POST /api/security-incidents/notification-preview': (c) => {
        previews.push(c.body);
        const personal = ((c.body as { data_kinds: string[] }).data_kinds ?? []).includes('personal_information');
        const item = (id: string, party: string, hours: number) => ({ rule_id: id, party, trigger_attribute: 'x', deadline_hours: hours, required: true, guidance: null, due_at: iso(hours * HOUR) });
        return { discovered_at: iso(0), notifications: personal ? [item('p2', 'Privacy office', 72), item('p1', 'Regional oversight desk', 24)] : [item('p1', 'Regional oversight desk', 24)], not_configured: [] };
      },
      'POST /api/security-incidents': (c) => { created.push(c.body); return { id: 'new1' }; },
    },
  });
}

describe('declaring a security incident', () => {
  it('needs a title before moving on, and previews the notifications for the starting answers', async () => {
    const previews: unknown[] = [];
    ui = await declare(previews, []);
    // The answers start at "a cyber incident": the preview asks with that answer.
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ is_cyber_incident: true, data_kinds: [] }));
    await waitFor(() => expect(textOf(ui!.container.querySelector('.si-preview-card'))).toContain('Regional oversight desk'));
    expect(textOf(ui.container.querySelector('.si-preview-card'))).toContain('1 with a deadline');

    await click(byText(ui.container, 'button[type="submit"]', 'Continue'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('Give the incident a short title.'));
    expect(textOf(ui.container)).toContain('1. What happened');
  });

  it('follows the answers in the preview and declares with the status the lifecycle gives', async () => {
    const previews: unknown[] = [];
    const created: unknown[] = [];
    ui = await declare(previews, created);
    await waitFor(() => expect(previews.at(-1)).toMatchObject({ is_cyber_incident: true }));
    await typeInto(byLabel(ui.container, 'Title'), 'Ransom note on the scheduling server');
    await click(byText(ui.container, '[role="radio"]', 'Major'));
    await click(byText(ui.container, 'button[type="submit"]', 'Continue'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('2. What is involved'));

    await click(byLabel(ui.container, 'Was personal information involved?'));
    await waitFor(() => expect(previews.some((p) => (p as { data_kinds: string[] }).data_kinds.includes('personal_information'))).toBe(true));
    await waitFor(() => expect(textOf(ui!.container.querySelector('.si-preview-card'))).toContain('Privacy office'));
    // Shortest deadline first.
    const parties = [...ui.container.querySelectorAll('.si-preview-top strong')].map((s) => textOf(s));
    expect(parties).toEqual(['Regional oversight desk', 'Privacy office']);

    await click(byText(ui.container, 'button[type="submit"]', 'Continue'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('3. Review and declare'));
    const review = textOf(ui.container.querySelector('.si-review'));
    expect(review).toContain('Ransom note on the scheduling server');
    expect(review).toContain('Major');
    expect(review).toContain('Was personal information involved?');
    expect(textOf(ui.container)).toContain('2 notification clocks start');

    await click(byText(ui.container, 'button', 'Confirm and declare incident'));
    await waitFor(() => expect(created.length).toBe(1));
    expect(created[0]).toMatchObject({
      title: 'Ransom note on the scheduling server', severity: 'major', status: 'responding',
      is_cyber_incident: true, data_kinds: ['personal_information'],
    });
    await waitFor(() => expect(ui!.location()).toBe('/security-incidents/new1'));
  });
});
