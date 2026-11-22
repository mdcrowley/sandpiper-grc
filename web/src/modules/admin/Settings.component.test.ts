// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META } from '../../core/componentMeta';
import { byLabel, byText, click, render, reply, waitFor, type Harness } from '../../core/componentHarness';
import type { Meta } from '../../core/meta';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { SettingsPage } = await import('./Settings');

// E23-12: the action sources whose actions need closure evidence, chosen under Administration >
// Settings. The row shows only when the server offers the setting. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const META: Meta = {
  ...GIZMO_META,
  lookups: {
    ...GIZMO_META.lookups,
    action_source: [
      { value: 'audit', label: 'Audit', color: 'gray', sort: 10 },
      { value: 'inspection', label: 'Inspection', color: 'gray', sort: 20 },
      { value: 'risk', label: 'Risk', color: 'gray', sort: 30 },
    ],
  },
};

const BASE = {
  'app.name': 'Sandpiper GRC', pilot_mode: true, features: {},
  'auth.password_min_length': 14, 'auth.password_history': 5, 'auth.idle_minutes': 30, 'auth.mfa_required_for_all': false,
  'auth.mfa_enforcement': 'notice', 'auth.mfa_grace_days': 0, 'auth.reauth_minutes': 10,
};

function page(values: Record<string, unknown>, saved: unknown[]) {
  return render(h(SettingsPage), {
    meta: META, route: '/admin/settings',
    handlers: {
      'GET /api/admin/settings': () => ({ values, featureKeys: [] }),
      'PATCH /api/admin/settings': (c) => { saved.push(c.body); return { values: { ...values, ...(c.body as object) }, featureKeys: [] }; },
      'GET /api/auth/security': () => ({ totpEnabled: true }),
      'GET /api/attachments/config': () => reply(404, { error: { code: 'not_found', message: 'Not found.' } }),
      'GET /api/admin/departments': () => [],
    },
  });
}

describe('closure evidence sources (E23-12)', () => {
  it('lists the action sources and saves the ones checked', async () => {
    const saved: unknown[] = [];
    ui = await page({ ...BASE, 'actions.closure_evidence_sources': ['risk'] }, saved);
    await waitFor(() => expect(byText(ui!.container, 'h2', 'Actions')).not.toBeNull());
    const box = (label: string) => byLabel(ui!.container, label);
    await waitFor(() => expect(box('Inspection')).not.toBeNull());
    expect((box('Risk') as HTMLInputElement).checked).toBe(true);
    expect((box('Audit') as HTMLInputElement).checked).toBe(false);
    await click(box('Inspection'));
    await click(box('Audit'));
    await waitFor(() => expect(byText(ui!.container, '.adm-unsaved', '1 unsaved change')).not.toBeNull());
    await click(byText(ui.container, 'button', 'Save settings'));
    await waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0]).toEqual({ 'actions.closure_evidence_sources': ['audit', 'inspection', 'risk'] });
  });

  it('is not shown when the server does not offer the setting', async () => {
    ui = await page({ ...BASE }, []);
    await waitFor(() => expect(byText(ui!.container, 'h2', 'Security')).not.toBeNull());
    expect(byText(ui.container, 'h2', 'Actions')).toBeNull();
    expect(byText(ui.container, '.adm-setting-title', 'Evidence needed before closing')).toBeNull();
  });
});
