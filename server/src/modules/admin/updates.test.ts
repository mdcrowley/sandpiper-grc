import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { appVersion } from '../../ops/files.ts';
import { compareVersions, parseVersion, RELEASES_URL, releaseFrom, setReleaseFetcher } from './updates.ts';

// Administration > About and the update check (E42-06): nothing is asked of GitHub unless the check
// is on, outbound connections are on and api.github.com is an allowed host; then at most once a
// day, with no data about the installation; the answer is shown to administrators only.
let t: Awaited<ReturnType<typeof testApp>>;
const calls: { url: string; allowList: unknown }[] = [];
let answer: unknown = null;

beforeAll(async () => {
  t = await testApp();
  setReleaseFetcher(async (url, allowList) => {
    calls.push({ url, allowList });
    if (answer instanceof Error) throw answer;
    return answer;
  });
}, 60_000);
afterAll(async () => { setReleaseFetcher(null); await t?.close(); });

const bump = (v: string) => { const p = parseVersion(v)!.parts; return `${p[0]}.${p[1]}.${p[2] + 1}`; };

describe('version comparison', () => {
  it('orders releases, pre-releases and tags', () => {
    expect(compareVersions('0.2.1', '0.2.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('nonsense', '1.0.0')).toBe(0);
  });

  it('reads a GitHub release and ignores drafts, pre-releases and odd tags', () => {
    expect(releaseFrom({ tag_name: 'v1.2.3', html_url: 'https://github.com/mdcrowley/sandpiper-grc/releases/tag/v1.2.3', published_at: '2026-11-01T00:00:00Z', name: 'Sandpiper GRC 1.2.3' }))
      .toEqual({ version: '1.2.3', url: 'https://github.com/mdcrowley/sandpiper-grc/releases/tag/v1.2.3', publishedAt: '2026-11-01T00:00:00Z', name: 'Sandpiper GRC 1.2.3' });
    expect(releaseFrom({ tag_name: 'v1.2.3', prerelease: true })).toBeNull();
    expect(releaseFrom({ tag_name: 'latest' })).toBeNull();
    // A link anywhere but GitHub is replaced by the releases page.
    expect(releaseFrom({ tag_name: '1.2.3', html_url: 'https://elsewhere.example.test/' })!.url).toBe('https://github.com/mdcrowley/sandpiper-grc/releases');
  });
});

describe('Administration > About', () => {
  it('shows the version and asks nothing while outbound connections are off (the default)', async () => {
    const res = await t.api.get('/api/admin/about');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(appVersion());
    expect(res.body.node).toBe(process.version);
    expect(res.body.updateCheck).toMatchObject({ enabled: true, blockedBy: 'outbound_off', latest: null, newer: false });
    expect(calls).toHaveLength(0);
  });

  it('asks nothing while api.github.com is not an allowed host', async () => {
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    await t.ctx.settings.set('integrations.allowed_hosts', ['hooks.example.test']);
    expect((await t.api.get('/api/admin/about')).body.updateCheck.blockedBy).toBe('host_not_allowed');
    expect(calls).toHaveLength(0);
  });

  it('asks GitHub once a day when allowed, and says a newer release exists', async () => {
    await t.ctx.settings.set('integrations.allowed_hosts', ['api.github.com']);
    answer = { tag_name: `v${bump(appVersion())}`, html_url: 'https://github.com/mdcrowley/sandpiper-grc/releases/tag/vX', published_at: '2026-11-20T00:00:00Z', name: 'Next' };
    const first = (await t.api.get('/api/admin/about')).body.updateCheck;
    expect(calls).toEqual([{ url: RELEASES_URL, allowList: ['api.github.com'] }]);
    expect(first).toMatchObject({ blockedBy: null, newer: true, error: null, latest: { version: bump(appVersion()) } });
    // Within the day: the stored answer, no second call.
    const second = (await t.api.get('/api/admin/about')).body.updateCheck;
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(calls).toHaveLength(1);
  });

  it('records a failed check and does not try again within the day', async () => {
    await t.ctx.settings.set('updates.state', { checkedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), release: null, error: null });
    answer = new Error('GitHub answered 503.');
    const res = (await t.api.get('/api/admin/about')).body.updateCheck;
    expect(res).toMatchObject({ error: 'GitHub answered 503.', newer: false, latest: null });
    await t.api.get('/api/admin/about');
    expect(calls).toHaveLength(2);
  });

  it('says nothing is newer when the newest release is this one', async () => {
    await t.ctx.settings.set('updates.state', { checkedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), release: null, error: null });
    answer = { tag_name: `v${appVersion()}` };
    expect((await t.api.get('/api/admin/about')).body.updateCheck).toMatchObject({ newer: false, latest: { version: appVersion() } });
  });

  it('can be switched off by an administrator (audited), and then asks nothing', async () => {
    const before = calls.length;
    expect((await t.api.patch('/api/admin/about', { updateCheck: 'yes' })).status).toBe(400);
    const off = await t.api.patch('/api/admin/about', { updateCheck: false });
    expect(off.status).toBe(200);
    expect(off.body.updateCheck).toMatchObject({ enabled: false, blockedBy: null });
    await t.ctx.settings.set('updates.state', { checkedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), release: null, error: null });
    await t.api.get('/api/admin/about');
    expect(calls.length).toBe(before);
    const audit = await t.db.query<{ summary: string }>("select summary from audit_events where action = 'setting.change' and summary like '%check_enabled%'");
    expect(audit).toHaveLength(1);
    expect((await t.api.patch('/api/admin/about', { updateCheck: true })).body.updateCheck.enabled).toBe(true);
  });

  it('is for administrators only', async () => {
    const viewer = await t.as('agent');
    expect((await viewer.get('/api/admin/about')).status).toBe(403);
    expect((await viewer.patch('/api/admin/about', { updateCheck: false })).status).toBe(403);
    // Everyone signed in still sees the plain version, never the update check.
    const plain = (await viewer.get('/api/version')).body;
    expect(plain.updateCheck).toBeUndefined();
  });
});
