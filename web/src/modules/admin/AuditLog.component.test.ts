// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { byLabel, byText, click, render, textOf, typeInto, waitFor, type Harness } from '../../core/componentHarness';

vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { AuditLogPage } = await import('./AuditLog');

// E40-06: the Audit page does not count the whole log ("more than 10,000"), and administrators can
// switch on the archive of old events. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const event = (id: number) => ({
  id, at: '2030-01-31T08:00:00Z', actor_id: null, actor_name: 'Pat Example', ip: '127.0.0.1', action: 'ticket.update',
  record_type: null, record_id: null, summary: `Invented event ${id}`, before: null, after: null,
});
const page = (p: number, over: Record<string, unknown> = {}) => ({
  rows: Array.from({ length: 3 }, (_, i) => event(p * 10 + i)), total: 10_000, totalCapped: true, hasMore: true, page: p, pageSize: 50, ...over,
});
const ARCHIVE = { settings: { enabled: false, olderThanMonths: 84, folder: '' }, permitted: true, oldest: '2023-01-02T00:00:00Z', runs: [], job: null };

describe('the Audit log page at scale (E40-06)', () => {
  it('says "more than" and pages on without a page count', async () => {
    ui = await render(h(AuditLogPage), {
      meta,
      handlers: {
        'GET /api/audit': (c) => page(Number(c.query.get('page') ?? 1), Number(c.query.get('page')) >= 2 ? { hasMore: false } : {}),
        'GET /api/audit/archive': () => ARCHIVE,
      },
    });
    await waitFor(() => expect(byText(ui!.container, '[role="status"]', 'More than 10,000 events, newest first')).not.toBeNull());
    expect(textOf(ui.container)).toContain('Page 1');
    expect(textOf(ui.container)).not.toMatch(/Page 1 of/);
    await click(byText(ui.container, 'button', 'Older'));
    await waitFor(() => expect(byText(ui!.container, 'td', 'Invented event 20')).not.toBeNull());
    expect((byText(ui.container, 'button', 'Older') as HTMLButtonElement).disabled).toBe(true);
  });

  it('counts exactly below the cap', async () => {
    ui = await render(h(AuditLogPage), {
      meta, permissions: ['audit.view'],
      handlers: { 'GET /api/audit': () => page(1, { total: 3, totalCapped: false, hasMore: false }) },
    });
    await waitFor(() => expect(byText(ui!.container, '[role="status"]', '3 events, newest first')).not.toBeNull());
    // Without admin.administer there is no archive card, and it is never asked for.
    expect(byText(ui.container, 'h2, h3', 'Archive old events')).toBeNull();
    expect(ui.calls.some((c) => c.path === '/api/audit/archive')).toBe(false);
  });
});

describe('archiving old events (E40-06)', () => {
  it('is off by default and saves the age and folder', async () => {
    let saved: unknown = null;
    ui = await render(h(AuditLogPage), {
      meta,
      handlers: {
        'GET /api/audit': () => page(1, { total: 3, totalCapped: false, hasMore: false }),
        'GET /api/audit/archive': () => ARCHIVE,
        'PUT /api/audit/archive': (c) => { saved = c.body; return { ...ARCHIVE, settings: c.body }; },
      },
    });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Save archive settings')).not.toBeNull());
    expect(textOf(ui.container)).toContain('Off unless you switch it on');
    expect(byText(ui.container, 'button', 'Archive now')).toBeNull();
    await click(byLabel(ui.container, 'Archive old events every day'));
    await typeInto(byLabel(ui.container, 'Folder for archive files'), '/srv/archive/sandpiper');
    await click(byText(ui.container, 'button', 'Save archive settings'));
    await waitFor(() => expect(saved).toEqual({ enabled: true, olderThanMonths: 84, folder: '/srv/archive/sandpiper' }));
  });
});
