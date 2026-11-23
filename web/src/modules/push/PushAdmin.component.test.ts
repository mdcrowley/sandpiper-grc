// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { byLabel, byText, render, textOf, typeInto, waitFor, type Harness } from '../../core/componentHarness';

// The module registry is built by the web build; a component test needs none of it.
vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
// Mantine's growing text areas listen to document.fonts, which happy-dom does not have.
if (!(document as { fonts?: unknown }).fonts) Object.defineProperty(document, 'fonts', { value: new EventTarget(), configurable: true });
const { PushAdminPage } = await import('./PushAdmin');

// Administration > Push notifications (W17 review): "Make a new key" reloads the settings from the
// server, so it waits while there are unsaved edits instead of discarding them. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const none = { apns: 0, fcm: 0, unifiedpush: 0 };
const view = {
  config: {
    apns: { enabled: false, keyId: '', teamId: '', bundleId: '', keySet: false, keyFingerprint: null },
    fcm: { enabled: false, projectId: '', clientEmail: '', keySet: false, keyFingerprint: null },
    unifiedpush: { enabled: true, allowedHosts: ['push.example.org'], vapidPublicKey: 'BExampleKey', contact: '' },
    updatedAt: null,
  },
  stats: { registrations: none, failing: none, retrying: none, lastError: { apns: null, fcm: null, unifiedpush: null }, lastSentAt: null },
};

describe('push notification settings', () => {
  it('disables "Make a new key" while there are unsaved edits', async () => {
    ui = await render(h(PushAdminPage), { meta, handlers: { 'GET /api/push/admin/config': () => view } });
    const newKey = () => byText(ui!.container, 'button', 'Make a new key') as HTMLButtonElement | null;
    await waitFor(() => expect(newKey()).not.toBeNull());
    expect(newKey()!.disabled).toBe(false);
    expect(textOf(ui.container)).not.toContain('Save your changes before making a new key.');

    await typeInto(byLabel(ui.container, 'Contact (optional)'), 'mailto:push-admin@example.org');
    await waitFor(() => expect(newKey()!.disabled).toBe(true));
    expect(textOf(ui.container)).toContain('Save your changes before making a new key.');
    // Nothing was asked of the server beyond loading the page.
    expect(ui.calls.filter((c) => c.method !== 'GET')).toEqual([]);

    // Back to the stored value: the button is offered again.
    await typeInto(byLabel(ui.container, 'Contact (optional)'), '');
    await waitFor(() => expect(newKey()!.disabled).toBe(false));
  });
});
