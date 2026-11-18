import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dueDate, loadPolicy, today } from './policy.ts';

/** Rules that hold however a finding is written: by hand, by the import or by the seed. */

const text = (v: unknown) => String(v ?? '').trim();

/** "cve-2030-0001; CVE-2030-0002" -> "CVE-2030-0001, CVE-2030-0002" (unique, sorted). */
export function normaliseCves(v: unknown): string {
  const parts = text(v).toUpperCase().split(/[\s,;|]+/).filter(Boolean);
  return [...new Set(parts)].sort().join(', ');
}

/** The duplicate key: host (name, else address) and finding identifier (scanner id, else CVEs, else title). */
export function keysFor(f: Row): { host_key: string; finding_key: string } {
  const host = text(f.host_name) || text(f.host_ip);
  const plugin = text(f.plugin_id);
  const cves = normaliseCves(f.cves);
  const finding = plugin ? `id:${plugin}` : cves ? `cve:${cves}` : `title:${text(f.title)}`;
  return { host_key: host.toLowerCase(), finding_key: finding.toLowerCase() };
}

const GUARDED: [field: string, type: string, label: string][] = [
  ['system_id', 'system', 'System'],
  ['asset_id', 'asset', 'Asset'],
  ['exception_id', 'policy_exception', 'Exception'],
];

/** A reference to another module's record is only accepted when that module is loaded and the record is visible. */
async function checkRefs(ctx: ModuleContext, req: FastifyRequest | null, patch: Row) {
  for (const [field, type, label] of GUARDED) {
    const id = patch[field];
    if (id === undefined || id === null) continue;
    if (!ctx.resources.get(type)) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: `${label}s are not available in this installation.` });
    }
    if (!(await ctx.resources.find(type, id, req?.user))) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: `${label} not found.` });
    }
  }
}

async function applyRules(ctx: ModuleContext, req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
  const merged: Row = { ...(existing ?? {}), ...patch };
  await checkRefs(ctx, req, patch);

  if (patch.cves !== undefined && patch.cves !== null) patch.cves = merged.cves = normaliseCves(patch.cves) || null;
  if (patch.cvss !== undefined && patch.cvss !== null && (patch.cvss < 0 || patch.cvss > 10)) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { cvss: 'A CVSS score is between 0 and 10.' });
  }
  if (!existing) {
    patch.first_seen = merged.first_seen = merged.first_seen ?? today();
    patch.last_seen = merged.last_seen = merged.last_seen ?? merged.first_seen;
  }
  if (!existing || ['host_name', 'host_ip', 'plugin_id', 'cves', 'title'].some((k) => k in patch)) {
    Object.assign(patch, keysFor(merged));
  }

  // Status rules come from the status list's meta, so an administrator can add statuses.
  const statuses = await ctx.lookups.values('vulnerability_status');
  const meta = (statuses.find((s) => s.value === merged.status)?.meta ?? {}) as Row;
  const statusChanged = !existing || existing.status !== merged.status;
  if (meta.acceptance === true) {
    const byException = !!merged.exception_id;
    const byRecord = !!text(merged.acceptance_justification) && !!merged.acceptance_approver_id;
    if (!byException && !byRecord) {
      const message = 'Link an approved exception, or record a justification and who approved it.';
      ctx.fail(400, 'validation', 'A finding can only be marked risk accepted with an exception, or with a justification and an approver.', {
        ...(ctx.resources.get('policy_exception') ? { exception_id: message } : {}),
        ...(text(merged.acceptance_justification) ? {} : { acceptance_justification: message }),
        ...(merged.acceptance_approver_id ? {} : { acceptance_approver_id: message }),
      });
    }
  }
  if (meta.reason === true && !text(merged.false_positive_reason)) {
    ctx.fail(400, 'validation', 'Say why this finding is a false positive.', { false_positive_reason: 'A reason is required.' });
  }
  if (statusChanged) {
    patch.closed = meta.closed === true;
    if (meta.fixed === true) {
      if (!merged.fixed_on) patch.fixed_on = merged.fixed_on = today();
    } else if (meta.closed !== true && merged.fixed_on && !('fixed_on' in patch)) {
      patch.fixed_on = merged.fixed_on = null; // reopened
    }
  }
  if (merged.fixed_on && merged.first_seen && String(merged.fixed_on) < String(merged.first_seen)) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { fixed_on: 'Fixed on cannot be before first seen.' });
  }

  if (merged.due_override_on && !text(merged.due_override_reason)) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { due_override_reason: 'Give the reason for changing the fix-by date.' });
  }
  if (!existing || ['severity', 'known_exploited', 'first_seen', 'due_override_on'].some((k) => k in patch)) {
    patch.due_on = dueDate(await loadPolicy(ctx), merged);
  }
  return patch;
}

export function findingHooks(ctx: ModuleContext) {
  return {
    beforeCreate: (req: FastifyRequest | null, data: Row) => applyRules(ctx, req, null, data),
    beforeUpdate: (req: FastifyRequest | null, existing: Row, patch: Row) => applyRules(ctx, req, existing, patch),
  };
}
