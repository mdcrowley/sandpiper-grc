// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byText, click, render, reply, textOf, typeInto, waitFor, type Call, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { AssessmentTab } = await import('./Assessment');
const { ExclusionChecks } = await import('./Lifecycle');
const { EvidenceExpiryCheck } = await import('./EvidenceExpiry');

// E40-12: the vendor pages' own logic: the security assessment (the latest score and its gaps,
// raising an action from a gap, answering a draft as it goes and completing it once every question
// is answered), the exclusion-list checks (a result other than clear needs a note) and the evidence
// expiry check (copying one date onto the other). Invented data only.

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
    exclusion_list: [{ value: 'national_debarment', label: 'National debarment list', color: 'gray', sort: 10 }],
    exclusion_result: [
      { value: 'clear', label: 'Clear', color: 'green', sort: 10 },
      { value: 'possible_match', label: 'Possible match', color: 'amber', sort: 20 },
      { value: 'match', label: 'Match', color: 'red', sort: 30 },
    ],
  },
};

const page = () => document.body;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const QUESTIONS = [
  { key: 'q1', section: 'Access', text: 'Do staff use multi-factor sign-in?', guidance: null, weight: 3 },
  { key: 'q2', section: 'Access', text: 'Are leavers removed within a day?', guidance: 'Ask for the last quarter\'s report.', weight: 2 },
];

const row = (patch: Record<string, unknown>) => ({
  id: 'a1', status: 'completed', assessed_on: '2026-10-05', score: 72, version: 3, answered: 2, total: 2, gaps: 2, notes: null,
  evidence_item_id: null, completed_by_name: 'Pat Example', ...patch,
});

describe('the vendor security assessment', () => {
  it('shows the latest score with its gaps, and raises an action from a gap', async () => {
    const calls: Call[] = [];
    ui = await render(h(AssessmentTab, { vendorId: 'v1' }), {
      meta: META,
      handlers: {
        'GET /api/vendors/v1/assessments': () => ({ rows: [row({})], can_raise_actions: true }),
        'GET /api/vendor-assessments/a1': () => ({
          ...row({}), questions: QUESTIONS, answers: {},
          gap_list: [
            { key: 'q1', section: 'Access', text: 'Do staff use multi-factor sign-in?', weight: 3, answer: 'partial', note: 'Only for administrators', action_id: 'act9' },
            { key: 'q2', section: 'Access', text: 'Are leavers removed within a day?', weight: 2, answer: 'no', note: null, action_id: null },
          ],
        }),
        'POST /api/vendor-assessments/a1/gaps/q2/action': (c) => { calls.push(c); return { ref: 'ACT-00031' }; },
      },
    });
    await waitFor(() => expect(textOf(ui!.container)).toContain('72 out of 100'));
    expect(textOf(ui.container)).toContain('Some gaps');
    expect(textOf(ui.container.querySelector('.vnd-result-title'))).toBe('Outstanding gaps 2');
    const gaps = [...ui.container.querySelectorAll('.vnd-gap')];
    expect(textOf(gaps[0])).toContain('Only for administrators');
    expect(textOf(gaps[0])).toContain('Partly');
    expect(gaps[0].querySelector('a[href="/actions/act9"]')).not.toBeNull();
    expect(textOf(gaps[1])).toContain('No');
    expect(byText(ui.container, 'button', 'Assess again')).not.toBeNull();
    // The history lists the completed assessment.
    expect(ui.container.querySelectorAll('table tbody tr').length).toBe(1);

    await click(byText(gaps[1], 'button', 'Raise action'));
    await waitFor(() => expect(calls.length).toBe(1));
    expect([calls[0].method, calls[0].path]).toEqual(['POST', '/api/vendor-assessments/a1/gaps/q2/action']);
    await waitFor(() => expect(textOf(page())).toContain('Action ACT-00031 raised.'));
  });

  it('starts an assessment, saves each answer as it is chosen and completes it once every question is answered', async () => {
    const calls: Call[] = [];
    let answers: Record<string, { answer: string }> = { q1: { answer: 'yes' } };
    const draft = () => ({
      ...row({ id: 'a2', status: 'draft', assessed_on: null, score: Object.keys(answers).length === 2 ? 100 : 60, answered: Object.keys(answers).length, gaps: 0, completed_by_name: null }),
      questions: QUESTIONS, answers, gap_list: [],
    });
    let started = false;
    ui = await render(h(AssessmentTab, { vendorId: 'v1' }), {
      meta: META,
      handlers: {
        'GET /api/vendors/v1/assessments': () => ({ rows: started ? [row({ id: 'a2', status: 'draft', answered: 1 })] : [], can_raise_actions: true }),
        'POST /api/vendors/v1/assessments': (c) => { calls.push(c); started = true; return { id: 'a2' }; },
        'GET /api/vendor-assessments/a2': () => draft(),
        'PATCH /api/vendor-assessments/a2': (c) => {
          calls.push(c);
          answers = { ...answers, ...(c.body as { answers: typeof answers }).answers };
          return draft();
        },
        'POST /api/vendor-assessments/a2/complete': (c) => { calls.push(c); return { ok: true }; },
      },
    });
    await waitFor(() => expect(textOf(ui!.container)).toContain('Not assessed yet'));
    await click(byText(ui.container, 'button', 'Start assessment'));
    await waitFor(() => expect(textOf(page())).toContain('1 of 2 answered'));
    expect([calls[0].method, calls[0].path]).toEqual(['POST', '/api/vendors/v1/assessments']);
    const complete = () => byText(page(), 'button', 'Complete assessment') as HTMLButtonElement;
    expect(textOf(complete())).toBe('Complete assessment (1 to answer)');
    expect(complete().disabled).toBe(true);

    // Answer the second question: "Yes".
    const question = [...page().querySelectorAll('.vnd-assess-q')].find((q) => textOf(q).includes('Are leavers removed'))!;
    const yes = [...question.querySelectorAll('label')].find((l) => textOf(l) === 'Yes')!;
    await click(document.getElementById(yes.getAttribute('for')!));
    await waitFor(() => expect(calls.length).toBe(2));
    expect([calls[1].method, calls[1].path, calls[1].body]).toEqual(['PATCH', '/api/vendor-assessments/a2', { answers: { q2: { answer: 'yes' } } }]);
    await waitFor(() => expect(textOf(page())).toContain('2 of 2 answered'));
    await waitFor(() => expect(complete().disabled).toBe(false));
    expect(textOf(complete())).toBe('Complete assessment');

    await click(complete());
    await waitFor(() => expect(calls.length).toBe(3));
    expect([calls[2].method, calls[2].path]).toEqual(['POST', '/api/vendor-assessments/a2/complete']);
    const body = calls[2].body as Record<string, unknown>;
    expect(body.assessed_on).toMatch(DATE);
    expect(body).toMatchObject({ save_evidence: true, evidence_expires_on: null });
    await waitFor(() => expect(textOf(page())).toContain('Assessment completed.'));
  });

  it('asks for a note when a question is answered No', async () => {
    const answers: Record<string, { answer: string }> = {};
    ui = await render(h(AssessmentTab, { vendorId: 'v1' }), {
      meta: META,
      handlers: {
        'GET /api/vendors/v1/assessments': () => ({ rows: [row({ id: 'a3', status: 'draft', answered: 0, score: null })], can_raise_actions: false }),
        'GET /api/vendor-assessments/a3': () => ({ ...row({ id: 'a3', status: 'draft', answered: 0, score: null }), questions: QUESTIONS, answers, gap_list: [] }),
        'PATCH /api/vendor-assessments/a3': (c) => ({
          ...row({ id: 'a3', status: 'draft', answered: 1, score: 0 }), questions: QUESTIONS, answers: (c.body as { answers: typeof answers }).answers, gap_list: [],
        }),
      },
    });
    await waitFor(() => expect(textOf(ui!.container)).toContain('An assessment is in progress: 0 of 2 questions answered.'));
    await click(byText(ui.container, 'button', 'Continue assessment'));
    await waitFor(() => expect(page().querySelectorAll('.vnd-assess-q').length).toBe(2));
    expect(page().querySelectorAll('.vnd-assess-note').length).toBe(0);
    const question = page().querySelectorAll('.vnd-assess-q')[0];
    const no = [...question.querySelectorAll('label')].find((l) => textOf(l) === 'No')!;
    await click(document.getElementById(no.getAttribute('for')!));
    await waitFor(() => expect(question.querySelector('.vnd-assess-note input')).not.toBeNull());
    expect(question.querySelector('.vnd-assess-note input')?.getAttribute('placeholder')).toBe('What is missing, or what they said');
  });
});

describe('exclusion-list checks', () => {
  function checks(data: () => unknown, calls: Call[] = []) {
    return render(h(ExclusionChecks, { vendorId: 'v1' }), {
      meta: META,
      handlers: {
        'GET /api/vendors/v1/exclusion-checks': data,
        'POST /api/vendors/v1/exclusion-checks': (c) => { calls.push(c); return { id: 'x9' }; },
      },
    });
  }
  const answer = (rows: unknown[]) => ({ rows, months: 12, due_on: '2026-12-01', overdue: false, latest_result: null, before_contract: true, can_record: true });

  it('lists the checks with their results, and the next one due', async () => {
    ui = await checks(() => answer([
      { id: 'x1', checked_on: '2026-03-02', list_key: 'national_debarment', list_label: 'National debarment list', result: 'clear', result_label: 'Clear', reference: 'SRCH-1', note: null, checked_by_name: 'Pat Example', attachment_id: null, attachment_name: null },
      { id: 'x2', checked_on: '2025-03-01', list_key: 'national_debarment', list_label: 'National debarment list', result: 'possible_match', result_label: 'Possible match', reference: null, note: 'Same name, different address; ruled out.', checked_by_name: null, attachment_id: 'f1', attachment_name: 'search.pdf' },
    ]));
    await waitFor(() => expect(ui!.container.querySelectorAll('tbody tr').length).toBe(2));
    const rows = [...ui.container.querySelectorAll('tbody tr')].map((r) => textOf(r));
    expect(rows[0]).toContain('Clear');
    expect(rows[0]).toContain('SRCH-1');
    expect(rows[1]).toContain('Possible match');
    expect(rows[1]).toContain('File: search.pdf');
    expect(textOf(ui.container.querySelector('.vnd-lc-due'))).toContain('Every 12 months; a check is also needed before a contract becomes active.');
  });

  it('records a check, asking for a note when the result is not clear', async () => {
    const calls: Call[] = [];
    let rows: unknown[] = [];
    ui = await checks(() => answer(rows), calls);
    await waitFor(() => expect(textOf(ui!.container)).toContain('No checks recorded'));
    await click(byText(ui.container, 'button', 'Record a check'));
    const submit = () => [...page().querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => textOf(b) === 'Record the check');
    await waitFor(() => expect(submit()).toBeTruthy());

    await click(submit());
    await waitFor(() => expect(textOf(page())).toContain('Choose the result.'));
    // The only list is chosen already.
    expect(textOf(page())).not.toContain('Choose the list that was checked.');

    const label = (text: string) => [...page().querySelectorAll('form label')].find((l) => textOf(l).replace(/\s*\*$/, '') === text)!;
    const result = document.getElementById(label('Result').getAttribute('for')!)!;
    const option = () => {
      const list = document.getElementById(result.getAttribute('aria-controls') ?? '');
      return list ? byText(list, '[role="option"]', 'Possible match') : null;
    };
    // The dialog may still be settling its focus: open the list again until it shows.
    for (let tries = 0; tries < 5 && !option(); tries += 1) {
      await click(result);
      await waitFor(() => expect(option()).not.toBeNull(), 500).catch(() => undefined);
    }
    expect(option()).not.toBeNull();
    await click(option());
    await click(submit());
    await waitFor(() => expect(textOf(page())).toContain('Say what was found and what happens next.'));
    expect(calls).toEqual([]);

    await typeInto(document.getElementById(label('Note').getAttribute('for')!), 'Similar name; asked the vendor for registration papers.');
    rows = [];
    await click(submit());
    await waitFor(() => expect(calls.length).toBe(1));
    const body = calls[0].body as Record<string, unknown>;
    expect(body.checked_on).toMatch(DATE);
    expect(body).toMatchObject({
      list_key: 'national_debarment', result: 'possible_match', reference: '',
      note: 'Similar name; asked the vendor for registration papers.', attachment_id: null,
    });
    await waitFor(() => expect(textOf(page())).toContain('Exclusion-list check recorded.'));
  });

  it('shows the error when the checks cannot be read', async () => {
    ui = await checks(() => reply(500, { error: { code: 'internal', message: 'Checks unavailable.' } }));
    await waitFor(() => expect(textOf(ui!.container)).toContain('Checks unavailable.'));
  });
});

describe('the evidence expiry check', () => {
  function expiry(report: unknown, calls: Call[] = [], canEdit = true) {
    return render(h(EvidenceExpiryCheck, { itemId: 'e1', version: 1, canEdit, onChanged: () => undefined }), {
      meta: META,
      handlers: {
        'GET /api/evidence/e1/expiry': () => report,
        'POST /api/evidence/e1/expiry/align': (c) => { calls.push(c); return { ok: true }; },
      },
    });
  }
  const differing = {
    item: { id: 'e1', expires_on: '2027-01-31' },
    files: [
      { id: 'f1', file_name: 'certificate-2026.pdf', expires_on: '2027-03-31', differs: true },
      { id: 'f2', file_name: 'certificate-copy.pdf', expires_on: '2027-03-31', differs: true },
      { id: 'f3', file_name: 'letter.pdf', expires_on: '2027-01-31', differs: false },
    ],
    differs: true, files_available: true,
  };

  it('warns when the dates disagree and copies the file date onto the item, or the item date onto the files', async () => {
    const calls: Call[] = [];
    ui = await expiry(differing, calls);
    await waitFor(() => expect(textOf(ui!.container)).toContain('The expiry dates do not agree.'));
    const list = [...ui.container.querySelectorAll('.vnd-expiry-list li')].map((li) => textOf(li));
    expect(list.length).toBe(3);
    expect(list[1]).toContain('certificate-2026.pdf');
    expect(list.join(' ')).not.toContain('letter.pdf');
    // Two files share one date: one button for it.
    const useFile = [...ui.container.querySelectorAll('button')].filter((b) => textOf(b).endsWith('for the item'));
    expect(useFile.length).toBe(1);
    await click(useFile[0]);
    await waitFor(() => expect(calls.length).toBe(1));
    // Either file with that date will do: both carry it.
    expect(calls[0].body).toEqual({ use: 'file', attachment_id: expect.stringMatching(/^f[12]$/) });
    await waitFor(() => expect(textOf(page())).toContain("The item now carries the file's expiry date."));

    await click(byText(ui.container, 'button', 'Set the files to'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toEqual({ use: 'item' });
  });

  it('shows nothing when the dates agree, and no buttons to someone who may not edit', async () => {
    ui = await expiry({ ...differing, differs: false, files: [] });
    await waitFor(() => expect(ui!.calls.some((c) => c.path === '/api/evidence/e1/expiry')).toBe(true));
    await waitFor(() => expect(ui!.calls.length).toBeGreaterThan(0));
    expect(ui.container.querySelector('.vnd-expiry-check')).toBeNull();
    ui.unmount();
    ui = await expiry(differing, [], false);
    await waitFor(() => expect(textOf(ui!.container)).toContain('The expiry dates do not agree.'));
    expect(ui.container.querySelectorAll('.vnd-expiry-actions').length).toBe(0);
  });
});
