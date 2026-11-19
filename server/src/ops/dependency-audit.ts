import { spawnSync } from 'node:child_process';
import { repoRoot } from './files.ts';

// Dependency scanning (E16-13): `npm audit`, read with a policy that fails only on what can be
// acted on. A known vulnerability at or above the chosen severity fails the check when a fixed
// version exists (`npm audit fix`, an update, or a major update to plan); one that nobody can
// fix yet is listed, not failed, so the build is not blocked by something no one can change.
// The policy for how quickly each severity is dealt with is in docs/operations.md.

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface AuditFinding {
  name: string;
  severity: Severity;
  direct: boolean;
  /** 'fix' (a compatible update), 'major' (needs a major update of a package we name), 'none' (no fixed version yet). */
  fix: 'fix' | 'major' | 'none';
  /** Advisory titles and links, or the packages it comes through. */
  via: string[];
}

export interface AuditVerdict {
  ok: boolean;
  /** At or above the level, with a fix: these fail the check. */
  actionable: AuditFinding[];
  /** At or above the level, no fix yet: reported only. */
  waiting: AuditFinding[];
  /** Below the level. */
  below: AuditFinding[];
  counts: Partial<Record<Severity, number>>;
}

interface NpmAuditJson {
  vulnerabilities?: Record<string, {
    name: string;
    severity: Severity;
    isDirect?: boolean;
    via?: (string | { title?: string; url?: string; name?: string })[];
    fixAvailable?: boolean | { name: string; version: string; isSemVerMajor?: boolean };
  }>;
  metadata?: { vulnerabilities?: Partial<Record<Severity | 'total', number>> };
  error?: { code?: string; summary?: string };
}

/** Applies the policy to the JSON that `npm audit --json` prints. */
export function assessAudit(report: NpmAuditJson, level: Severity = 'high'): AuditVerdict {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const findings: AuditFinding[] = Object.values(report.vulnerabilities ?? {}).map((v) => ({
    name: v.name,
    severity: v.severity,
    direct: !!v.isDirect,
    fix: v.fixAvailable === false || v.fixAvailable === undefined ? 'none'
      : typeof v.fixAvailable === 'object' && v.fixAvailable.isSemVerMajor ? 'major' : 'fix',
    via: (v.via ?? []).map((x) => (typeof x === 'string' ? `through ${x}` : `${x.title ?? x.name ?? 'advisory'}${x.url ? ` (${x.url})` : ''}`)),
  }));
  findings.sort((a, b) => rank(b.severity) - rank(a.severity) || a.name.localeCompare(b.name));
  const atLevel = findings.filter((f) => rank(f.severity) >= rank(level));
  const actionable = atLevel.filter((f) => f.fix !== 'none');
  const counts: AuditVerdict['counts'] = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return { ok: actionable.length === 0, actionable, waiting: atLevel.filter((f) => f.fix === 'none'), below: findings.filter((f) => rank(f.severity) < rank(level)), counts };
}

export function formatVerdict(v: AuditVerdict, level: Severity, scope: string): string {
  const line = (f: AuditFinding) =>
    `  - ${f.name} (${f.severity}${f.direct ? ', direct' : ''}; ${f.fix === 'fix' ? 'fixed version available: npm audit fix' : f.fix === 'major' ? 'fixed only in a new major version' : 'no fixed version yet'})` +
    (f.via.length ? `\n      ${f.via.slice(0, 3).join('\n      ')}` : '');
  const total = Object.values(v.counts).reduce((a, b) => a + (b ?? 0), 0);
  const out = [`Dependency audit (${scope}, failing at ${level} and above when a fix exists): ${total ? Object.entries(v.counts).map(([s, n]) => `${n} ${s}`).join(', ') : 'no known vulnerabilities'}`];
  if (v.actionable.length) out.push(`FIX NEEDED (${v.actionable.length}):`, ...v.actionable.map(line));
  if (v.waiting.length) out.push(`Waiting for a fix upstream (reported, not failing; check again at the next audit) (${v.waiting.length}):`, ...v.waiting.map(line));
  if (v.below.length) out.push(`Below ${level} (${v.below.length}): ${v.below.map((f) => `${f.name} (${f.severity})`).join(', ')}`);
  out.push(v.ok ? 'Dependency audit passed.' : 'Dependency audit FAILED: update the packages above (Dependabot proposes most of these each week).');
  return out.join('\n');
}

export interface RunAuditResult {
  /** 0 passed, 1 failed the policy, 3 the audit could not run (no network, registry down). */
  code: 0 | 1 | 3;
  text: string;
}

/** Runs `npm audit --json` in the repository and applies the policy. */
export function runAudit(opts: { level?: Severity; includeDev?: boolean; cwd?: string } = {}): RunAuditResult {
  const level = opts.level ?? 'high';
  const args = ['audit', '--json', ...(opts.includeDev ? [] : ['--omit=dev'])];
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = spawnSync(npm, args, { cwd: opts.cwd ?? repoRoot, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  let report: NpmAuditJson;
  try {
    report = JSON.parse(run.stdout || '{}');
  } catch {
    return { code: 3, text: `The dependency audit could not run: npm audit printed no report (${(run.stderr || run.error?.message || 'no output').trim().split('\n')[0]}).` };
  }
  if (report.error || (!report.vulnerabilities && !report.metadata)) {
    return { code: 3, text: `The dependency audit could not run: ${report.error?.summary ?? report.error?.code ?? 'npm audit gave no result'} (it needs to reach the npm registry).` };
  }
  const verdict = assessAudit(report, level);
  return { code: verdict.ok ? 0 : 1, text: formatVerdict(verdict, level, opts.includeDev ? 'all packages' : 'production packages') };
}
