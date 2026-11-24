// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byText, click, render, reply, textOf, typeInto, waitFor, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';
import type { RecordContext, ResourceMeta, Row } from '../../core';
import type { Scale } from './scales';
import type { HeatMapData } from './HeatMap';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { ScoringPanel } = await import('./ScoringPanel');
const { AcceptancePanel } = await import('./AcceptancePanel');
const { HeatMap } = await import('./HeatMap');

// E40-12: the risk pages' own logic: the assessment (ratings worked out from the scale's matrix,
// both ends or neither, only changed scores saved), the acceptance rule (an executive approver when
// the rating is at or above the threshold, revoking needs a reason) and the heat map's cells.
// Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
// happy-dom has no font loading; Mantine's growing text boxes listen for it.
beforeAll(() => {
  const doc = document as unknown as { fonts?: unknown };
  if (!doc.fonts) doc.fonts = { addEventListener: () => undefined, removeEventListener: () => undefined };
});

const META: Meta = GIZMO_META;

const SCALE: Scale = {
  key: 'three', name: 'Three by three', description: null,
  likelihood_label: 'Likelihood', impact_label: 'Impact',
  likelihood_levels: [{ value: 1, label: 'Rare' }, { value: 2, label: 'Possible' }, { value: 3, label: 'Likely' }],
  impact_levels: [{ value: 1, label: 'Minor' }, { value: 2, label: 'Moderate' }, { value: 3, label: 'Severe' }],
  matrix: {
    1: { 1: 'low', 2: 'low', 3: 'medium' },
    2: { 1: 'low', 2: 'medium', 3: 'high' },
    3: { 1: 'medium', 2: 'high', 3: 'high' },
  },
  ratings: [
    { key: 'low', label: 'Low', color: 'green', sort: 1, summary_level: 'low' },
    { key: 'medium', label: 'Medium', color: 'amber', sort: 2, summary_level: 'medium' },
    { key: 'high', label: 'High', color: 'red', sort: 3, summary_level: 'high' },
  ],
  acceptance_threshold: 'high',
};

const RESOURCE = { type: 'risk', label: 'Risk', plural: 'Risks', module: 'risks', path: '/api/risks', route: '/risks', fields: {} } as unknown as ResourceMeta;

function context(row: Partial<Row>, save = vi.fn(async (patch: Record<string, unknown>) => ({ ...row, ...patch }) as Row)): RecordContext & { save: typeof save } {
  return { row: { id: 'r1', scale_key: 'three', ...row } as Row, resource: RESOURCE, reload: vi.fn(), save, canEdit: true };
}

const page = () => document.body;
/** The pickers whose label starts with `label`, in page order (inherent first, then residual). */
const pickers = (label: string) => [...page().querySelectorAll('label')]
  .filter((l) => textOf(l).startsWith(label))
  .map((l) => document.getElementById(l.getAttribute('for') ?? '') as HTMLInputElement)
  .filter(Boolean);

/** Picks `option` in the list that `input` opens (every picker's list stays in the document). */
async function choose(input: HTMLElement, option: string) {
  const found = () => {
    const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
    return list ? byText(list, '[role="option"]', option) : null;
  };
  // Open the list again if a moving focus closed it before it showed.
  for (let tries = 0; tries < 5 && !found(); tries += 1) {
    await click(input);
    await waitFor(() => expect(found()).not.toBeNull(), 500).catch(() => undefined);
  }
  expect(found()).not.toBeNull();
  await click(found());
}

describe('the risk assessment (scoring panel)', () => {
  it('shows each end rated from the scale, with the levels and the matrix described in words', async () => {
    const rec = context({ inherent_likelihood: 3, inherent_impact: 3, residual_likelihood: 2, residual_impact: 1, existing_controls: 'Two-person sign-off on depot keys' });
    ui = await render(h(ScoringPanel, { rec, scale: SCALE }), { meta: META });
    await waitFor(() => expect(byText(ui!.container, '.rk-assess-inherent', 'High')).not.toBeNull());
    expect(textOf(ui.container.querySelector('.rk-assess-inherent'))).toContain('Likely');
    expect(textOf(ui.container.querySelector('.rk-assess-inherent'))).toContain('Severe');
    expect(textOf(ui.container.querySelector('.rk-assess-residual'))).toContain('Low');
    expect(textOf(ui.container.querySelector('.rk-assess-residual'))).toContain('Possible');
    expect(textOf(ui.container.querySelector('.rk-assess-controls'))).toContain('Two-person sign-off on depot keys');
    const figure = ui.container.querySelector('.rk-mini');
    expect(figure?.getAttribute('aria-label')).toBe(
      'Position on the Three by three matrix: inherent risk Likely by Severe, rated High; residual risk Possible by Minor, rated Low.',
    );
    // The inherent and residual cells are marked on the small matrix.
    const marked = [...ui.container.querySelectorAll('.rk-mini-cell.is-marked')].map((c) => textOf(c));
    expect(marked.sort()).toEqual(['I', 'R']);
  });

  it('re-rates as a level is chosen and saves only the score that changed', async () => {
    const rec = context({ inherent_likelihood: 3, inherent_impact: 3, residual_likelihood: 2, residual_impact: 1 });
    ui = await render(h(ScoringPanel, { rec, scale: SCALE }), { meta: META });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Change scores')).not.toBeNull());
    await click(byText(ui.container, 'button', 'Change scores'));
    await waitFor(() => expect(pickers('Likelihood').length).toBe(2));
    const save = () => byText(ui!.container, 'button', 'Save scores') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    await choose(pickers('Likelihood')[1], 'Likely');
    // Likely by Minor is Medium on this scale: the chip follows before anything is saved.
    await waitFor(() => expect(textOf(ui!.container.querySelector('.rk-assess-residual .rk-assess-rating'))).toBe('Medium'));
    expect(save().disabled).toBe(false);
    await click(save());
    await waitFor(() => expect(rec.save).toHaveBeenCalledTimes(1));
    expect(rec.save).toHaveBeenCalledWith({ residual_likelihood: 3 });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Change scores')).not.toBeNull());
  });

  it('asks for both likelihood and impact, or neither, before saving', async () => {
    const rec = context({ inherent_likelihood: 2, inherent_impact: 2, residual_likelihood: null, residual_impact: null });
    ui = await render(h(ScoringPanel, { rec, scale: SCALE }), { meta: META });
    await waitFor(() => expect(textOf(ui!.container.querySelector('.rk-assess-residual'))).toContain('Not scored'));
    await click(byText(ui.container, 'button', 'Change scores'));
    await waitFor(() => expect(pickers('Likelihood').length).toBe(2));
    await choose(pickers('Likelihood')[1], 'Rare');
    await click(byText(ui.container, 'button', 'Save scores'));
    await waitFor(() => expect(textOf(ui!.container)).toContain('Give both likelihood and impact, or neither.'));
    expect(pickers('Impact')[1].getAttribute('aria-invalid')).toBe('true');
    expect(rec.save).not.toHaveBeenCalled();
  });

  it('says so when the scale the risk was scored on no longer exists', async () => {
    ui = await render(h(ScoringPanel, { rec: context({ scale_key: 'retired' }), scale: undefined }), { meta: META });
    await waitFor(() => expect(textOf(ui!.container)).toContain('The scale this risk was scored on (retired) no longer exists.'));
    expect(byText(ui.container, 'button', 'Change scores')).toBeNull();
  });
});

const ACCEPTANCE = (exec: boolean, acceptances: Row[] = []) => ({
  acceptances,
  rule: exec
    ? { rating: 'high', rating_label: 'High', threshold: 'high', threshold_label: 'High', executive_required: true }
    : { rating: 'medium', rating_label: 'Medium', threshold: 'high', threshold_label: 'High', executive_required: false },
});

function acceptancePage(data: unknown, posted: { path: string; body: unknown }[]) {
  return render(h(AcceptancePanel, { rec: context({ inherent_likelihood: 3, inherent_impact: 3 }) }), {
    meta: META,
    handlers: {
      'GET /api/risks/r1/acceptances': () => data,
      'GET /api/risks/r1/acceptance-request': () => ({ available: false, request: null }),
      'POST /api/risks/r1/acceptances/a1/revoke': (c) => { posted.push({ path: c.path, body: c.body }); return { ok: true }; },
      'POST /api/risks/r1/acceptances': (c) => { posted.push({ path: c.path, body: c.body }); return { ok: true }; },
    },
  });
}

describe('risk acceptance', () => {
  it('needs a named executive approver when the rating is at or above the threshold', async () => {
    const posted: { path: string; body: unknown }[] = [];
    ui = await acceptancePage(ACCEPTANCE(true), posted);
    await waitFor(() => expect(textOf(ui!.container)).toContain('Executive approval needed'));
    expect(textOf(ui.container)).toContain('This risk is rated High, which is at or above the threshold (High)');
    expect(textOf(ui.container)).toContain('No acceptance has been recorded for this risk.');
    await click(byText(ui.container, 'button', 'Record by hand'));
    await waitFor(() => expect(byText(page(), 'button', 'Record acceptance')).not.toBeNull());
    await click(byText(page(), 'button', 'Record acceptance'));
    await waitFor(() => expect(textOf(page())).toContain('Name the executive who approved the acceptance.'));
    expect(textOf(page())).toContain("Give the approver's title.");
    expect(textOf(page())).toContain('Give a reference for the approval.');
    expect(textOf(page())).toContain('Give the date the acceptance expires.');
    expect(textOf(page())).toContain('Say why the risk is being accepted.');
    expect(posted).toEqual([]);
  });

  it('below the threshold asks only for the expiry date and the rationale', async () => {
    ui = await acceptancePage(ACCEPTANCE(false), []);
    await waitFor(() => expect(textOf(ui!.container)).toContain('The executive-approval rule'));
    expect(textOf(ui.container)).toContain('below the executive-approval threshold (High)');
    await click(byText(ui.container, 'button', 'Record by hand'));
    await waitFor(() => expect(byText(page(), 'button', 'Record acceptance')).not.toBeNull());
    await click(byText(page(), 'button', 'Record acceptance'));
    await waitFor(() => expect(textOf(page())).toContain('Say why the risk is being accepted.'));
    expect(textOf(page())).not.toContain('Name the executive who approved the acceptance.');
  });

  it('revokes the standing acceptance only with a reason', async () => {
    const posted: { path: string; body: unknown }[] = [];
    const standing = {
      id: 'a1', state: 'current', expired: false, days_left: 30, approved_on: '2026-06-01', expires_on: '2026-12-24',
      approver_name: 'Alex Sample', approver_title: 'Chief Operating Officer', reference: 'MEMO-17', rationale: 'Mitigation funded next year.',
      recorded_by: 'Pat Example', executive_required: true,
    } as unknown as Row;
    ui = await acceptancePage(ACCEPTANCE(true, [standing]), posted);
    await waitFor(() => expect(textOf(ui!.container)).toContain('Current acceptance'));
    expect(textOf(ui.container)).toContain('Expires in 30 days');
    expect(textOf(ui.container)).toContain('Alex Sample, Chief Operating Officer');
    expect(byText(ui.container, 'button', 'Renew by hand')).not.toBeNull();

    await click(byText(ui.container, 'button', 'Revoke acceptance'));
    const submit = () => [...page().querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => textOf(b) === 'Revoke acceptance');
    await waitFor(() => expect(submit()).toBeTruthy());
    await click(submit());
    await waitFor(() => expect(textOf(page())).toContain('Say why the acceptance is being revoked.'));
    expect(posted).toEqual([]);

    const reason = [...page().querySelectorAll('label')].find((l) => textOf(l).startsWith('Reason'));
    await typeInto(document.getElementById(reason!.getAttribute('for')!), 'The mitigation was canceled.');
    await click(submit());
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toEqual({ path: '/api/risks/r1/acceptances/a1/revoke', body: { reason: 'The mitigation was canceled.', revoked_on: '' } });
  });

  it('shows the error when the acceptances cannot be read', async () => {
    ui = await render(h(AcceptancePanel, { rec: context({}) }), {
      meta: META,
      handlers: {
        'GET /api/risks/r1/acceptances': () => reply(500, { error: { code: 'internal', message: 'The database is not answering.' } }),
        'GET /api/risks/r1/acceptance-request': () => ({ available: false, request: null }),
      },
    });
    await waitFor(() => expect(textOf(ui!.container)).toContain('The database is not answering.'));
    expect(byText(ui.container, 'button', 'Record by hand')).toBeNull();
  });
});

describe('the heat map', () => {
  const data: HeatMapData = {
    scale: SCALE, basis: 'residual', total: 3, unscored: 1, include_closed: false, movements: [], risks: [],
    cells: [1, 2, 3].flatMap((l) => [1, 2, 3].map((i) => ({
      likelihood: l, impact: i, rating: SCALE.matrix[l][i], color: 'gray',
      count: l === 3 && i === 3 ? 2 : l === 1 && i === 2 ? 1 : 0,
      risk_ids: l === 3 && i === 3 ? ['r1', 'r2'] : l === 1 && i === 2 ? ['r3'] : [],
      above_appetite: l === 3 && i === 3,
    }))),
    totals: [{ rating: 'high', label: 'High', color: 'red', count: 2 }, { rating: 'low', label: 'Low', color: 'green', count: 1 }],
    appetite: { rating: 'medium', label: 'Medium', categories: ['Operations'] },
  };

  it('counts the risks in each cell, names it in words and chooses only a cell with risks', async () => {
    const onSelect = vi.fn();
    ui = await render(h(HeatMap, { data, selected: null, onSelect, showMovement: false }), { meta: META });
    await waitFor(() => expect(ui!.container.querySelectorAll('button.rk-cell').length).toBe(9));
    const cell = (name: string) => [...ui!.container.querySelectorAll<HTMLButtonElement>('button.rk-cell')].find((b) => textOf(b).includes(name))!;
    expect(textOf(cell('Likely by Severe'))).toBe('2 High risks: Likely by Severe, above appetite');
    expect(textOf(cell('Rare by Moderate'))).toBe('1 Low risk: Rare by Moderate');
    expect(cell('Possible by Minor').getAttribute('aria-disabled')).toBe('true');
    expect(textOf(ui.container.querySelector('.rk-legend'))).toContain('Not yet scored 1');
    expect(textOf(ui.container.querySelector('.rk-legend'))).toContain('Above appetite (Medium or lower is accepted for Operations)');

    await click(cell('Possible by Minor'));
    expect(onSelect).not.toHaveBeenCalled();
    await click(cell('Likely by Severe'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ likelihood: 3, impact: 3, risk_ids: ['r1', 'r2'] }));
  });

  it('a second click on the chosen cell clears the choice', async () => {
    const onSelect = vi.fn();
    ui = await render(h(HeatMap, { data, selected: '3.3', onSelect, showMovement: false }), { meta: META });
    await waitFor(() => expect(ui!.container.querySelector('button.rk-cell[aria-pressed="true"]')).not.toBeNull());
    await click(ui.container.querySelector('button.rk-cell[aria-pressed="true"]'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
