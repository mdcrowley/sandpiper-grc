import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

/**
 * The severity policy: how many days a finding of each severity may stay open, counted
 * from the day it was first seen. It is data (a setting), edited on the policy page.
 */

export const POLICY_KEY = 'vulnerabilities.severity_policy';

export interface SeverityPolicy {
  /** Days allowed per severity value; null or missing = no fix-by date. */
  days: Record<string, number | null>;
  /** Known-exploited findings get at most this severity's period. Empty = no shortening. */
  knownExploitedSeverity: string;
}

export const DEFAULT_POLICY: SeverityPolicy = {
  days: { critical: 15, high: 30, medium: 90, low: 180, informational: null },
  knownExploitedSeverity: 'critical',
};

export const today = () => todayInZone();

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadPolicy(ctx: ModuleContext): Promise<SeverityPolicy> {
  const saved = await ctx.settings.get<Partial<SeverityPolicy> | null>(POLICY_KEY, null);
  return {
    days: { ...DEFAULT_POLICY.days, ...(saved?.days ?? {}) },
    knownExploitedSeverity: saved?.knownExploitedSeverity ?? DEFAULT_POLICY.knownExploitedSeverity,
  };
}

/** Days allowed for one finding, or null when the policy sets no period. */
export function allowedDays(policy: SeverityPolicy, severity: string, knownExploited: boolean): number | null {
  const own = policy.days[severity] ?? null;
  const fast = knownExploited && policy.knownExploitedSeverity ? policy.days[policy.knownExploitedSeverity] ?? null : null;
  if (own === null) return fast;
  return fast === null ? own : Math.min(own, fast);
}

/** The fix-by date: a recorded override wins, otherwise first seen plus the days allowed. */
export function dueDate(policy: SeverityPolicy, f: Row): string | null {
  if (f.due_override_on) return String(f.due_override_on);
  if (!f.first_seen || !f.severity) return null;
  const days = allowedDays(policy, String(f.severity), f.known_exploited === true);
  return days === null ? null : addDays(String(f.first_seen), days);
}

/** Both permissions a hand-written vulnerability route needs: findings are security records. */
export function secured(ctx: ModuleContext, perm: string) {
  const checks = [ctx.requirePerm(perm), ctx.requirePerm('security.view')];
  return async (req: FastifyRequest, reply: FastifyReply) => {
    for (const check of checks) await check(req, reply);
  };
}

export function registerPolicy(ctx: ModuleContext) {
  const { app } = ctx;

  app.get('/api/vulnerabilities/policy', { preHandler: secured(ctx, 'vulnerabilities.view') }, async () => loadPolicy(ctx));

  /**
   * Body: { days: { <severity>: number | null }, knownExploitedSeverity }. Saving recalculates
   * the fix-by date of every finding that is still open and has no override.
   */
  app.post('/api/vulnerabilities/policy', { preHandler: secured(ctx, 'vulnerabilities.administer') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const severities = (await ctx.lookups.values('vulnerability_severity')).map((s) => s.value);
    const fields: Record<string, string> = {};
    const days: Record<string, number | null> = {};
    const input = (body.days && typeof body.days === 'object' ? body.days : {}) as Row;
    for (const sev of severities) {
      const v = input[sev];
      if (v === null || v === undefined || v === '') { days[sev] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 3650) fields[`days.${sev}`] = 'Enter a whole number of days between 1 and 3650, or leave it empty.';
      else days[sev] = n;
    }
    const fast = String(body.knownExploitedSeverity ?? '');
    if (fast && !severities.includes(fast)) fields.knownExploitedSeverity = 'Choose a severity from the list.';
    else if (fast && days[fast] === null) fields.knownExploitedSeverity = 'That severity has no period to borrow. Give it one or choose another.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const policy: SeverityPolicy = { days, knownExploitedSeverity: fast };
    await ctx.settings.set(POLICY_KEY, policy, req);
    const recalculated = await recalculateDueDates(ctx, policy);
    await ctx.audit(req, {
      action: 'vulnerability.policy', recordType: 'vulnerability',
      summary: `Severity policy changed; fix-by dates recalculated for ${recalculated} open findings`,
      after: { ...policy, recalculated },
    });
    return { ...policy, recalculated };
  });
}

/** Applies the policy to every open finding without an override. Returns how many dates changed. */
export async function recalculateDueDates(ctx: ModuleContext, policy: SeverityPolicy): Promise<number> {
  const rows = await ctx.db.query<Row>(
    `select id, severity, known_exploited, first_seen, due_on from vulnerabilities
     where deleted_at is null and not closed and due_override_on is null`,
  );
  let changed = 0;
  for (const r of rows) {
    const due = dueDate(policy, r);
    if ((r.due_on ?? null) === due) continue;
    await ctx.db.query('update vulnerabilities set due_on = $2 where id = $1', [r.id, due]);
    changed++;
  }
  return changed;
}
