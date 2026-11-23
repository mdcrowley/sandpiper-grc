// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBranding } from '../../core/branding';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { render, waitFor, type Harness } from '../../core/componentHarness';

vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { ConfigProvider, usePortalTitle } = await import('./parts');

// Wave 15: a portal page names itself in the browser tab, as a page of the main application does, so a
// screen reader reads the page and not only the application name on a fresh load. The application
// name stays last, so the organization's branding (applied when the session state arrives) replaces
// it in place instead of the whole title.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

function Page({ title }: { title: string | null }) {
  usePortalTitle(title);
  return h('h1', null, title ?? 'Loading');
}

const config = { title: 'Help and requests' } as Parameters<typeof ConfigProvider>[0]['value'];

describe('portal page titles', () => {
  it('name the page, the portal and the application, and keep the page when branding arrives', async () => {
    document.title = 'Sandpiper GRC';
    ui = await render(h(ConfigProvider, { value: config }, h(Page, { title: 'My requests' })), { meta });
    await waitFor(() => expect(document.title).toBe('My requests · Help and requests · Sandpiper GRC'));
    applyBranding({ appName: 'Harbor Line GRC' });
    expect(document.title).toBe('My requests · Help and requests · Harbor Line GRC');
    applyBranding({ appName: 'Sandpiper GRC' });
  });

  it('do not repeat the portal name on its home page, and leave the title alone while a page loads', async () => {
    document.title = 'Sandpiper GRC';
    ui = await render(h(ConfigProvider, { value: config }, h(Page, { title: 'Help and requests' })), { meta });
    await waitFor(() => expect(document.title).toBe('Help and requests · Sandpiper GRC'));
    ui.unmount();
    ui = await render(h(ConfigProvider, { value: config }, h(Page, { title: null })), { meta });
    expect(document.title).toBe('Sandpiper GRC');
  });
});
