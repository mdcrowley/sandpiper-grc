import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { computeDue, criticalityOf, hasSystems, loadPolicy, today } from './policy.ts';
import { notifyAssigned } from './notify.ts';

/** Rules that hold however a finding is written: by hand, by the import or by the seed. */

const text = (v: unknown) => String(v ?? '').trim();
const lower = (v: unknown) => text(v).toLowerCase();

/** "cve-2030-0001; CVE-2030-0002" -> "CVE-2030-0001, CVE-2030-0002" (unique, sorted). */
export function normaliseCves(v: unknown): string {
  const parts = text(v).toUpperCase().split(/[\s,;|]+/).filter(Boolean);
  return [...new Set(parts)].sort().join(', ');
}

/** The finding identifier: scanner id, else the CVE list, else the title. */
export function findingKey(f: Row): string {
  const plugin = text(f.plugin_id);
  const cves = normaliseCves(f.cves);
  return (plugin ? `id:${plugin}` : cves ? `cve:${cves}` : `title:${text(f.title)}`).toLowerCase();
}

/**
 * The port part of the duplicate key: "443/tcp", or "443" when the protocol is not known,
 * or '' for a finding that belongs to the host as a whole (no port, or port 0). The protocol
 * comes from its own field, else from the port text ("443/tcp", "tcp/443", "443 (tcp)").
 * Migration 002 applies the same reading to rows written before this key existed.
 */
export function portKey(port: unknown, protocol?: unknown): string {
  const p = lower(port);
  let proto = lower(protocol).replace(/[^a-z0-9]/g, '');
  let number = '';
  let m: RegExpExecArray | null;
  if (/^\d*$/.test(p)) number = p;
  else if ((m = /^(\d+)\s*[/ (]\s*([a-z]+)\s*\)?$/.exec(p))) { number = m[1]; proto ||= m[2]; }
  else if ((m = /^([a-z]+)\s*[/ ]\s*(\d+)$/.exec(p))) { number = m[2]; proto ||= m[1]; }
  else return p; // not a number: kept as written, so two different texts stay two findings
  if (!number || /^0+$/.test(number)) return '';
  return proto ? `${number}/${proto}` : number;
}

/** Splits a port key into its number and protocol ('' when not known). */
export function portParts(key: string): { number: string; protocol: string } {
  const at = key.indexOf('/');
  return at < 0 ? { number: key, protocol: '' } : { number: key.slice(0, at), protocol: key.slice(at + 1) };
}

/**
 * Two port keys name the same port when they are equal, or when the numbers match and one
 * of them does not say the protocol (one export wrote "443", the next "443/tcp").
 */
export function samePort(a: string, b: string): boolean {
  if (a === b) return true;
  const x = portParts(a);
  const y = portParts(b);
  return x.number !== '' && x.number === y.number && (x.protocol === '' || y.protocol === '');
}

/**
 * The parts of the duplicate key that need no look-up. `host_key` here is the plain one
 * (name, else address); `resolveHostKey` then reconciles it with hosts already recorded.
 */
export function keysFor(f: Row): { host_key: string; finding_key: string; port_key: string } {
  return { host_key: lower(f.host_name) || lower(f.host_ip), finding_key: findingKey(f), port_key: portKey(f.port, f.protocol) };
}

/**
 * Which recorded hosts a name or an address belongs to. A name always identifies its host.
 * An address identifies a host only when one side has no name: a row with a name never joins
 * a differently named host just because they share an address (addresses get reused).
 * The import plans with this in memory; `resolveHostKey` asks the same questions of the database.
 */
export class HostIndex {
  private byName = new Map<string, string>();
  /** Host keys seen at an address, most recent last. */
  private byAddress = new Map<string, string[]>();
  /** Host keys that have a name on at least one finding. */
  private named = new Set<string>();

  /** Feed recorded rows oldest first, so the most recently seen host wins a shared address. */
  learn(hostName: unknown, hostIp: unknown, key: string): void {
    const name = lower(hostName);
    const ip = lower(hostIp);
    if (!key) return;
    if (name) {
      if (!this.byName.has(name)) this.byName.set(name, key);
      this.named.add(key);
    }
    if (ip) this.byAddress.set(ip, [...(this.byAddress.get(ip) ?? []).filter((k) => k !== key), key]);
  }

  /** The key of the host this name and address belong to; a new host gets its name, else its address. */
  resolve(hostName: unknown, hostIp: unknown): string {
    const name = lower(hostName);
    const ip = lower(hostIp);
    if (!name && !ip) return '';
    const atAddress = [...(this.byAddress.get(ip) ?? [])].reverse();
    const known = (name && this.byName.get(name)) || (name ? atAddress.find((k) => !this.named.has(k)) : atAddress[0]);
    const key = known || name || ip;
    this.learn(name, ip, key);
    return key;
  }
}

/** The host key for a finding being saved: the key of the recorded host it belongs to, else a new one. */
export async function resolveHostKey(ctx: ModuleContext, merged: Row, existing: Row | null): Promise<string> {
  const name = lower(merged.host_name);
  const ip = lower(merged.host_ip);
  if (!name && !ip) return '';
  const self = existing?.id ?? '00000000-0000-0000-0000-000000000000';
  const other = `from vulnerabilities where deleted_at is null and id <> $2 and host_key <> ''`;
  if (name) {
    const byName = await ctx.db.one<{ host_key: string }>(
      `select host_key ${other} and lower(host_name) = $1 order by last_seen desc nulls last, created_at desc limit 1`, [name, self]);
    if (byName) return byName.host_key;
  }
  if (ip) {
    // With a name in hand, only a host that has no name anywhere can be the same host.
    const nameless = `and not exists (select 1 from vulnerabilities n where n.deleted_at is null and n.id <> $2
      and n.host_key = vulnerabilities.host_key and coalesce(n.host_name, '') <> '')`;
    const byAddress = await ctx.db.one<{ host_key: string }>(
      `select host_key ${other} and lower(host_ip) = $1 ${name ? nameless : ''}
       order by last_seen desc nulls last, created_at desc limit 1`, [ip, self]);
    if (byAddress) return byAddress.host_key;
  }
  // Learning a second identifier (a name for an address, or the reverse) keeps the host it already was.
  if (existing?.host_key && ((name && name === lower(existing.host_name)) || (ip && ip === lower(existing.host_ip)))) return existing.host_key;
  return name || ip;
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

  // The duplicate key: host, port (with protocol) and finding identifier.
  if (!existing || 'host_name' in patch || 'host_ip' in patch) patch.host_key = await resolveHostKey(ctx, merged, existing);
  if (!existing || ['plugin_id', 'cves', 'title'].some((k) => k in patch)) patch.finding_key = findingKey(merged);
  if (!existing || 'port' in patch || 'protocol' in patch) patch.port_key = portKey(merged.port, merged.protocol);

  // An asset brings its system with it, so criticality and the system owner are known.
  if (patch.asset_id && !merged.system_id && hasSystems(ctx) && ctx.resources.get('asset')) {
    const asset = await ctx.db.one<{ system_id: string | null }>('select system_id from assets where id = $1 and deleted_at is null', [patch.asset_id]);
    if (asset?.system_id) patch.system_id = merged.system_id = asset.system_id;
  }

  // Status rules come from the status list's meta, so an administrator can add statuses.
  const statuses = await ctx.lookups.values('vulnerability_status');
  const meta = (statuses.find((s) => s.value === merged.status)?.meta ?? {}) as Row;
  const statusChanged = !existing || existing.status !== merged.status;
  if (meta.acceptance === true) {
    const acceptanceTouched = statusChanged || ['exception_id', 'acceptance_justification', 'acceptance_approver_id'].some((k) => k in patch);
    // An exception only covers a finding while it is approved and not past its expiry date.
    if (merged.exception_id && acceptanceTouched) {
      const ex = await ctx.db.one<{ status: string; expires_on: string | null }>(
        `select status, to_char(expires_on, 'YYYY-MM-DD') as expires_on from policy_exceptions where id = $1 and deleted_at is null`, [merged.exception_id],
      ).catch(() => undefined);
      if (!ex || ex.status !== 'approved' || (ex.expires_on && ex.expires_on < today())) {
        ctx.fail(400, 'validation', 'Only an approved exception that has not expired can cover a finding.', {
          exception_id: 'Choose an approved exception that has not expired.',
        });
      }
    }
    // Whoever records the acceptance cannot also be the person who approved it.
    if (req?.user && acceptanceTouched && !merged.exception_id && merged.acceptance_approver_id === req.user.id) {
      ctx.fail(400, 'validation', 'The risk must be approved by someone other than the person recording it.', {
        acceptance_approver_id: 'Choose someone other than yourself.',
      });
    }
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
  if (!existing || ['severity', 'known_exploited', 'first_seen', 'due_override_on', 'system_id'].some((k) => k in patch)) {
    Object.assign(patch, computeDue(await loadPolicy(ctx), merged, await criticalityOf(ctx, merged.system_id)));
  }
  return patch;
}

/**
 * Requests that are running an import. The import tells each new owner once, with a count,
 * so the per-finding "assigned to you" notification is skipped for these.
 */
export const importRequests = new WeakSet<FastifyRequest>();

export function findingHooks(ctx: ModuleContext) {
  // Only a person's action notifies: seeding and automation (no request) do not.
  const assigned = async (req: FastifyRequest | null, before: Row | null, row: Row) => {
    if (!req || importRequests.has(req) || !row.owner_id || row.owner_id === before?.owner_id) return;
    await notifyAssigned(ctx, row, req.user?.id ?? null);
  };
  return {
    beforeCreate: (req: FastifyRequest | null, data: Row) => applyRules(ctx, req, null, data),
    beforeUpdate: (req: FastifyRequest | null, existing: Row, patch: Row) => applyRules(ctx, req, existing, patch),
    afterCreate: (req: FastifyRequest | null, row: Row) => assigned(req, null, row),
    afterUpdate: (req: FastifyRequest | null, before: Row, after: Row) => assigned(req, before, after),
  };
}
