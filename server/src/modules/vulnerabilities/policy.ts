import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
export { addDays }; // one copy for every module (E40-12)

/**
 * The severity policy: how many days a finding of each severity may stay open, counted
 * from the day it was first seen, and how much of that period a finding on a critical
 * system gets. It is data (a setting), edited on the policy page.
 */

export const POLICY_KEY = 'vulnerabilities.severity_policy';
/** The inventory list whose values grade a system. Only present when that module is loaded. */
export const CRITICALITY_LIST = 'criticality_tier';

export interface SeverityPolicy {
  /** Days allowed per severity value; null or missing = no fix-by date. */
  days: Record<string, number | null>;
  /** Known-exploited findings get at most this severity's period. Empty = no shortening. */
  knownExploitedSeverity: string;
  /**
   * Share of the period (1 to 99 per cent) a finding gets when its system has this
   * criticality value. A value that is missing gets the whole period.
   */
  criticalityPercent: Record<string, number>;
}

export const DEFAULT_POLICY: SeverityPolicy = {
  days: { critical: 15, high: 30, medium: 90, low: 180, informational: null },
  knownExploitedSeverity: 'critical',
  criticalityPercent: {},
};

export const today = () => todayInZone();

export async function loadPolicy(ctx: ModuleContext): Promise<SeverityPolicy> {
  const saved = await ctx.settings.get<Partial<SeverityPolicy> | null>(POLICY_KEY, null);
  return {
    days: { ...DEFAULT_POLICY.days, ...(saved?.days ?? {}) },
    knownExploitedSeverity: saved?.knownExploitedSeverity ?? DEFAULT_POLICY.knownExploitedSeverity,
    criticalityPercent: { ...(saved?.criticalityPercent ?? {}) },
  };
}

/** Whether systems (and so criticality) exist in this installation. */
export const hasSystems = (ctx: ModuleContext) => ctx.resources.get('system') !== undefined;

/** The criticality values of the inventory module, or none when it is not loaded. */
export async function criticalityTiers(ctx: ModuleContext): Promise<{ value: string; label: string; color: string }[]> {
  if (!hasSystems(ctx)) return [];
  return (await ctx.lookups.values(CRITICALITY_LIST)).map((t) => ({ value: t.value, label: t.label, color: t.color ?? 'gray' }));
}

/** Days allowed for one finding before criticality is looked at, or null when the policy sets no period. */
export function allowedDays(policy: SeverityPolicy, severity: string, knownExploited: boolean): number | null {
  const own = policy.days[severity] ?? null;
  const fast = knownExploited && policy.knownExploitedSeverity ? policy.days[policy.knownExploitedSeverity] ?? null : null;
  if (own === null) return fast;
  return fast === null ? own : Math.min(own, fast);
}

/**
 * The fix-by date and the criticality value that shortened it (null when none did).
 * A recorded override wins; otherwise first seen plus the days allowed, reduced to the
 * policy's share for the criticality of the finding's system (never below one day).
 */
export function computeDue(policy: SeverityPolicy, f: Row, criticality: string | null = null): { due_on: string | null; due_criticality: string | null } {
  if (f.due_override_on) return { due_on: String(f.due_override_on), due_criticality: null };
  if (!f.first_seen || !f.severity) return { due_on: null, due_criticality: null };
  const days = allowedDays(policy, String(f.severity), f.known_exploited === true);
  if (days === null) return { due_on: null, due_criticality: null };
  const percent = criticality ? Number(policy.criticalityPercent[criticality]) : NaN;
  if (Number.isFinite(percent) && percent >= 1 && percent < 100) {
    const shortened = Math.max(1, Math.ceil((days * percent) / 100));
    if (shortened < days) return { due_on: addDays(String(f.first_seen), shortened), due_criticality: criticality };
  }
  return { due_on: addDays(String(f.first_seen), days), due_criticality: null };
}

/** The fix-by date alone (see computeDue). */
export function dueDate(policy: SeverityPolicy, f: Row, criticality: string | null = null): string | null {
  return computeDue(policy, f, criticality).due_on;
}

/** The criticality value of the system a finding is linked to, or null (also when inventory is not loaded). */
export async function criticalityOf(ctx: ModuleContext, systemId: unknown): Promise<string | null> {
  if (!systemId || !hasSystems(ctx)) return null;
  const row = await ctx.db.one<{ criticality_tier: string | null }>('select criticality_tier from systems where id = $1 and deleted_at is null', [systemId]);
  return row?.criticality_tier ?? null;
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

  // `criticalityTiers` is empty when the inventory module is not loaded: the page then hides that part.
  app.get('/api/vulnerabilities/policy', { preHandler: secured(ctx, 'vulnerabilities.view') }, async () => ({
    ...(await loadPolicy(ctx)), criticalityTiers: await criticalityTiers(ctx),
  }));

  /**
   * Body: { days: { <severity>: number | null }, knownExploitedSeverity,
   * criticalityPercent?: { <criticality value>: 1-100 | null } }. Saving recalculates the
   * fix-by date of every finding that is still open and has no override.
   */
  app.post('/api/vulnerabilities/policy', { preHandler: secured(ctx, 'vulnerabilities.administer') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const before = await loadPolicy(ctx);
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

    // Left out of the body: the saved shares are kept (older clients send only the days).
    let criticalityPercent = before.criticalityPercent;
    if (body.criticalityPercent !== undefined) {
      const tiers = (await criticalityTiers(ctx)).map((t) => t.value);
      const given = (body.criticalityPercent && typeof body.criticalityPercent === 'object' && !Array.isArray(body.criticalityPercent) ? body.criticalityPercent : {}) as Row;
      criticalityPercent = {};
      for (const [tier, v] of Object.entries(given)) {
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (!tiers.includes(tier)) fields[`criticalityPercent.${tier}`] = 'That criticality is not in the list.';
        else if (!Number.isInteger(n) || n < 1 || n > 100) fields[`criticalityPercent.${tier}`] = 'Enter a whole percentage between 1 and 100, or leave it empty.';
        else if (n < 100) criticalityPercent[tier] = n;
      }
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const policy: SeverityPolicy = { days, knownExploitedSeverity: fast, criticalityPercent };
    await ctx.settings.set(POLICY_KEY, policy, req);
    const recalculated = await recalculateDueDates(ctx, policy, req);
    await ctx.audit(req, {
      action: 'vulnerability.policy', recordType: 'vulnerability',
      summary: `Severity policy changed; fix-by dates recalculated for ${recalculated} open findings`,
      before, after: { ...policy, recalculated },
    });
    return { ...policy, criticalityTiers: await criticalityTiers(ctx), recalculated };
  });
}

/**
 * Applies the policy to every open finding without an override. Returns how many dates changed.
 * Also run by the daily sweep, so a change to a system's criticality reaches its findings.
 */
export async function recalculateDueDates(ctx: ModuleContext, policy: SeverityPolicy, req: FastifyRequest | null = null): Promise<number> {
  const rows = await ctx.db.query<Row>(
    `select id, ref, severity, known_exploited, first_seen, to_char(due_on, 'YYYY-MM-DD') as due_on, due_criticality, system_id from vulnerabilities
     where deleted_at is null and not closed and due_override_on is null`,
  );
  const tierOf = new Map<string, string | null>();
  if (hasSystems(ctx) && Object.keys(policy.criticalityPercent).length) {
    for (const s of await ctx.db.query<Row>('select id, criticality_tier from systems where deleted_at is null')) tierOf.set(s.id, s.criticality_tier ?? null);
  }
  let changed = 0;
  for (const r of rows) {
    const next = computeDue(policy, r, r.system_id ? tierOf.get(r.system_id) ?? null : null);
    if ((r.due_on ?? null) === next.due_on && (r.due_criticality ?? null) === next.due_criticality) continue;
    await ctx.db.query('update vulnerabilities set due_on = $2, due_criticality = $3, updated_at = now() where id = $1', [r.id, next.due_on, next.due_criticality]);
    // Each finding's own history shows the new date and why it moved.
    await ctx.audit(req, {
      action: 'vulnerability.update', recordType: 'vulnerability', recordId: r.id,
      summary: `Fix-by date recalculated from the severity policy${next.due_criticality ? ' and system criticality' : ''}`,
      before: { due_on: r.due_on ?? null, due_criticality: r.due_criticality ?? null },
      after: { due_on: next.due_on, due_criticality: next.due_criticality },
    });
    if ((r.due_on ?? null) !== next.due_on) changed++;
  }
  return changed;
}
