// Administration > About (E42-06): the installed version, and whether a newer release exists.
//
// The update check asks the project's public GitHub releases for the newest release, at most once a
// day and only while an administrator looks at the About page (nothing is checked in the
// background otherwise). It sends no personal or organization data: a plain GET with a fixed
// User-Agent, no cookies, no version, no host name. It runs only when all of these hold:
//   - the check is on (`updates.check_enabled`, on by default; switched off on the About page);
//   - outbound connections are on (`integrations.outbound_enabled`, off by default);
//   - api.github.com is on the allowed hosts (`integrations.allowed_hosts`).
// So a new installation checks nothing until an administrator allows outbound connections to
// GitHub. The connection is fenced like every outbound call (core/webhooks.ts): the address is
// resolved at connection time and checked, certificates are verified, redirects are not followed,
// the exchange is time-limited and the answer size-limited. The result is shown on the About page
// only, with a link to the release notes.
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { checkedLookup, hostAllowed, literalRefusal } from '../../core/webhooks.ts';
import type { ModuleContext } from '../../core/module.ts';
import { appVersion } from '../../ops/files.ts';
import { versionInfo } from '../../ops/version.ts';
import { adminRoute, body, invalid } from './shared.ts';

export const RELEASES_URL = 'https://api.github.com/repos/mdcrowley/sandpiper-grc/releases/latest';
export const RELEASES_PAGE = 'https://github.com/mdcrowley/sandpiper-grc/releases';
const USER_AGENT = 'sandpiper-grc-update-check';
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;

export const CHECK_SETTING = 'updates.check_enabled';
const STATE_SETTING = 'updates.state';

export interface Release { version: string; url: string; publishedAt: string | null; name: string | null }
export interface CheckState { checkedAt: string; release: Release | null; error: string | null }
export type ReleaseFetcher = (url: string, allowList: unknown) => Promise<unknown>;

/** `1.2.3`, `v1.2.3` or `1.2.3-rc.1` as numbers; a pre-release sorts before its release. Null when not a version. */
export function parseVersion(raw: unknown): { parts: [number, number, number]; pre: string | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(raw ?? '').trim());
  return m ? { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
}

/** Negative when a is older than b, 0 when equal, positive when newer. Unreadable versions compare equal. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i] - y.parts[i];
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The release named in GitHub's answer for the latest release, or null when the answer is not one. */
export function releaseFrom(answer: unknown): Release | null {
  if (!answer || typeof answer !== 'object') return null;
  const a = answer as Record<string, unknown>;
  if (a.draft === true || a.prerelease === true) return null;
  const parsed = parseVersion(a.tag_name);
  if (!parsed) return null;
  const url = typeof a.html_url === 'string' && a.html_url.startsWith('https://github.com/') ? a.html_url : RELEASES_PAGE;
  return {
    version: parsed.parts.join('.') + (parsed.pre ? `-${parsed.pre}` : ''),
    url,
    publishedAt: typeof a.published_at === 'string' ? a.published_at : null,
    name: typeof a.name === 'string' ? a.name.slice(0, 200) : null,
  };
}

/** One fenced GET for JSON (see the top of this file). */
export const fetchJson: ReleaseFetcher = (raw, allowList) => new Promise((resolve, reject) => {
  const url = new URL(raw);
  const port = url.port || '443';
  const blocked = literalRefusal(url.hostname, port, allowList);
  if (blocked) { reject(blocked); return; }
  const req = httpsRequest(url, {
    method: 'GET', lookup: checkedLookup(port, allowList), timeout: TIMEOUT_MS, rejectUnauthorized: true,
    headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
  }, (res: IncomingMessage) => {
    if ((res.statusCode ?? 0) !== 200) { res.resume(); reject(new Error(`GitHub answered ${res.statusCode}.`)); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) { req.destroy(new Error('The answer was too large.')); return; }
      chunks.push(c);
    });
    res.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('The answer was not JSON.')); }
    });
    res.on('error', reject);
  });
  const timer = setTimeout(() => req.destroy(new Error('No answer within 10 seconds.')), TIMEOUT_MS);
  timer.unref?.();
  req.on('timeout', () => req.destroy(new Error('No answer within 10 seconds.')));
  req.on('error', (err) => { clearTimeout(timer); reject(err); });
  req.on('close', () => clearTimeout(timer));
  req.end();
});

let fetcher: ReleaseFetcher = fetchJson;
/** Tests replace the network call. */
export function setReleaseFetcher(f: ReleaseFetcher | null): void { fetcher = f ?? fetchJson; }

let running: Promise<void> | null = null;

export function registerUpdates(ctx: ModuleContext): void {
  const { settings, db } = ctx;

  /** Why the check may not run, or null when it may. */
  const blockedBy = async (): Promise<'off' | 'outbound_off' | 'host_not_allowed' | null> => {
    if ((await settings.get<unknown>(CHECK_SETTING, true)) === false) return 'off';
    if ((await settings.get<unknown>('integrations.outbound_enabled', false)) !== true) return 'outbound_off';
    if (!hostAllowed(new URL(RELEASES_URL), await settings.get<unknown>('integrations.allowed_hosts', []))) return 'host_not_allowed';
    return null;
  };

  const check = async () => {
    let state: CheckState;
    try {
      const answer = await fetcher(RELEASES_URL, await settings.get<unknown>('integrations.allowed_hosts', []));
      const release = releaseFrom(answer);
      state = { checkedAt: new Date().toISOString(), release, error: release ? null : 'GitHub named no release.' };
    } catch (err) {
      state = { checkedAt: new Date().toISOString(), release: null, error: (err as Error).message.slice(0, 300) };
    }
    // Stored without an audit event: the result of a check is not a change anyone made.
    await db.query(
      `insert into settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [STATE_SETTING, JSON.stringify(state)],
    );
  };

  const overview = async () => {
    const enabled = (await settings.get<unknown>(CHECK_SETTING, true)) !== false;
    const blocked = await blockedBy();
    let state = await settings.get<CheckState | null>(STATE_SETTING, null);
    // At most once a day: a check (or a failed one) younger than a day is shown as it is.
    const stale = !state || !(Date.parse(state.checkedAt) > Date.now() - DAY_MS);
    if (!blocked && stale && !running) {
      running = check().finally(() => { running = null; });
    }
    if (running) {
      // A quick answer is shown at once; a slow one is shown when the page asks again.
      await Promise.race([running, new Promise((r) => setTimeout(r, 1500))]);
      state = await settings.get<CheckState | null>(STATE_SETTING, null);
    }
    const current = appVersion();
    const latest = state?.release ?? null;
    return {
      ...versionInfo(true),
      updateCheck: {
        enabled,
        blockedBy: blocked === 'off' ? null : blocked,
        checking: Boolean(running),
        checkedAt: state?.checkedAt ?? null,
        error: state?.error ?? null,
        latest,
        newer: Boolean(latest && compareVersions(latest.version, current) > 0),
        releasesPage: RELEASES_PAGE,
      },
    };
  };

  adminRoute(ctx, 'GET', '/api/admin/about', async () => overview());

  adminRoute(ctx, 'PATCH', '/api/admin/about', async (req) => {
    const b = body(req);
    if (typeof b.updateCheck !== 'boolean') invalid({ updateCheck: 'Choose on or off.' });
    const before = (await settings.get<unknown>(CHECK_SETTING, true)) !== false;
    // ctx.settings.set writes the audit event (setting.change) with before and after.
    if (before !== b.updateCheck) await settings.set(CHECK_SETTING, b.updateCheck, req);
    return overview();
  });

  const response = 'version, commit, node, database, startedAt, updateCheck: { enabled, blockedBy: null | "outbound_off" | "host_not_allowed", checking, checkedAt, error, latest: { version, url, publishedAt, name } | null, newer, releasesPage }';
  ctx.describeRoute({
    method: 'GET', path: '/api/admin/about', tag: 'System', permission: 'admin.administer',
    summary: 'The installed version and whether a newer release exists',
    description: 'Asks the project\'s GitHub releases at most once a day, only while the check is on, outbound connections are on and api.github.com is on the allowed hosts. Nothing about the installation or its people is sent.',
    response,
  });
  ctx.describeRoute({
    method: 'PATCH', path: '/api/admin/about', tag: 'System', permission: 'admin.administer',
    summary: 'Switch the update check on or off',
    body: { type: 'object', properties: { updateCheck: { type: 'boolean' } }, required: ['updateCheck'] },
    response,
  });
}

