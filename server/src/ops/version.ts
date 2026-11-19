import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl } from '../core/db.ts';
import type { ModuleContext } from '../core/module.ts';
import { appVersion, repoRoot } from './files.ts';

// The installed version, for people reporting a problem and administrators after an upgrade
// (E16-19). Never on the public health check: only signed-in people may ask.

export interface VersionInfo {
  version: string;
  /** The commit the code was built from, when known (GRC_COMMIT, set in the container image, or the git checkout). */
  commit: string | null;
  /** Administrators only. */
  node?: string;
  database?: 'embedded' | 'server';
  startedAt?: string;
}

/** The commit of a git checkout without running git: .git/HEAD, then the branch file or packed-refs. */
export function gitCommit(root: string = repoRoot): string | null {
  try {
    const gitDir = join(root, '.git');
    if (!existsSync(join(gitDir, 'HEAD'))) return null;
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/i.test(head)) return head.toLowerCase();
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    if (existsSync(join(gitDir, ref))) return readFileSync(join(gitDir, ref), 'utf8').trim().toLowerCase() || null;
    const packed = existsSync(join(gitDir, 'packed-refs')) ? readFileSync(join(gitDir, 'packed-refs'), 'utf8') : '';
    const line = packed.split('\n').find((l) => l.trim().endsWith(` ${ref}`));
    return line ? line.split(' ')[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** GRC_COMMIT (a hexadecimal commit id) or the git checkout's; null when neither is known. */
export function buildCommit(env: Record<string, string | undefined> = process.env): string | null {
  const given = env.GRC_COMMIT?.trim();
  if (given && /^[0-9a-f]{7,40}$/i.test(given)) return given.toLowerCase();
  return gitCommit();
}

const startedAt = new Date().toISOString();

export function versionInfo(admin: boolean): VersionInfo {
  const info: VersionInfo = { version: appVersion(), commit: buildCommit() };
  if (admin) Object.assign(info, { node: process.version, database: databaseUrl() ? 'server' : 'embedded', startedAt });
  return info;
}

/**
 * `GET /api/version` (signed in; administrators also see the Node.js version, the kind of
 * database and when the server started). Registered by core next to the health check.
 */
export function registerVersion(ctx: Pick<ModuleContext, 'app' | 'can' | 'describeRoute'>): void {
  ctx.app.get('/api/version', async (req) => versionInfo(!!req.user && ctx.can(req.user, 'admin.administer')));
  ctx.describeRoute({
    method: 'GET',
    path: '/api/version',
    summary: 'The installed version',
    description: 'The application version and the commit it was built from, when known. Administrators also see the Node.js version, the kind of database and when the server started. Not available without signing in: the health check does not reveal the version.',
    tag: 'System',
    response: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        commit: { type: ['string', 'null'] },
        node: { type: 'string' },
        database: { type: 'string', enum: ['embedded', 'server'] },
        startedAt: { type: 'string', format: 'date-time' },
      },
    },
  });
}
