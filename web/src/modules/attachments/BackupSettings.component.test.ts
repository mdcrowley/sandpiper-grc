// @vitest-environment happy-dom
import { createElement as h } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GIZMO_META as meta } from '../../core/componentMeta';
import { byText, click, render, textOf, waitFor, type Harness } from '../../core/componentHarness';

vi.mock('../../core/module', () => ({ modules: [], moduleOn: () => true }));
const { BackupSettings, progressText } = await import('./BackupSettings');

// E40-11: "Back up now" is a background job that the page follows; on a PostgreSQL server the page
// shows the checked database dumps and warns when the newest is too old. Invented data only.

let ui: Harness | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const SETTINGS = {
  enabled: false, time: '03:30', keep: 14, destination: 'folder', folder: '/srv/backups/sandpiper', s3Prefix: 'sandpiper-backups/',
  encrypt: false, includeSecretKey: false, pgDumpFolder: '', pgDumpMaxAgeHours: 26,
};
const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1', trigger: 'manual', status: 'ok', started_at: '2030-01-31T08:00:00Z', finished_at: '2030-01-31T08:01:00Z', destination: '/srv/backups/sandpiper',
  archive_name: 'sandpiper-backup-20300131-080000.tar', bytes: 2048, encrypted: false, verified: true, pruned: [], message: null,
  created_by_name: 'Pat Example', progress: null, job_id: 'j1', ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({
  settings: SETTINGS, timeZone: 'America/New_York', keySource: null, secretKeyNote: 'The secret key is kept beside the data folder.',
  secretKeyFile: true, s3Available: false, destination: '/srv/backups/sandpiper', running: false, active: null, queued: null,
  lastSuccess: null, runs: [], postgres: false, pgDumps: [], lastPgDump: null, pgDumpOverdue: false, ...over,
});

describe('Back up now (E40-11)', () => {
  it('queues the backup, follows its progress, and says how it went', async () => {
    let state: Record<string, unknown> = overview();
    ui = await render(h(BackupSettings), {
      meta,
      handlers: {
        'GET /api/backups': () => state,
        'POST /api/backups/run': () => {
          state = overview({ running: true, active: run({ status: 'running', archive_name: null, finished_at: null, progress: { stage: 'export', done: 12, total: 180, rows: 45000 } }) });
          return { jobId: 'j1', overview: state };
        },
      },
    });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Back up now')).not.toBeNull());
    await click(byText(ui.container, 'button', 'Back up now'));
    await waitFor(() => expect(textOf(ui!.container.querySelector('[role="status"].notice'))).toContain('Copying the database: 12 of 180 tables (45,000 rows).'));
    expect(ui.calls.filter((c) => c.method === 'POST' && c.path === '/api/backups/run')).toHaveLength(1);
    expect((byText(ui.container, 'button', 'Backing up') as HTMLButtonElement).disabled).toBe(true);

    // It finishes: the page looks again by itself and tells the result.
    state = overview({ runs: [run()], lastSuccess: run() });
    await waitFor(() => expect(byText(document.body, '*', 'Backed up and checked: sandpiper-backup-20300131-080000.tar (2.0 KB).')).not.toBeNull(), 5000);
    expect(byText(ui.container, 'button', 'Back up now')).not.toBeNull();
  });

  it('describes each stage in plain words', () => {
    expect(progressText(null)).toBe('Starting.');
    expect(progressText({ stage: 'upload' })).toBe('Writing it to the destination.');
    expect(progressText({ stage: 'check' })).toMatch(/Reading it back/);
  });
});

describe('PostgreSQL dumps (E40-11)', () => {
  it('lists the checked dumps and warns when the newest is too old', async () => {
    const dump = run({ id: 'd1', trigger: 'pg_dump', archive_name: 'grc-db-20300130-021500.dump', message: 'Checked: 42 entries, pg_dump 17.2', job_id: null });
    ui = await render(h(BackupSettings), {
      meta,
      handlers: {
        'GET /api/backups': () => overview({
          postgres: true, settings: { ...SETTINGS, pgDumpFolder: '/srv/backups/grc' }, pgDumps: [dump], lastPgDump: dump, pgDumpOverdue: true,
        }),
      },
    });
    await waitFor(() => expect(byText(ui!.container, 'td', 'grc-db-20300130-021500.dump')).not.toBeNull());
    expect(textOf(ui.container.querySelector('[role="alert"]'))).toMatch(/older than 26 hours/);
    expect(byText(ui.container, 'legend', 'PostgreSQL database dumps')).not.toBeNull();
  });

  it('shows nothing about dumps on the embedded database', async () => {
    ui = await render(h(BackupSettings), { meta, handlers: { 'GET /api/backups': () => overview() } });
    await waitFor(() => expect(byText(ui!.container, 'button', 'Back up now')).not.toBeNull());
    expect(textOf(ui.container)).not.toMatch(/PostgreSQL/);
  });
});
