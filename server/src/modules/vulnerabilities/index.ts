import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerImport } from './importer.ts';
import { registerPolicy } from './policy.ts';
import { findingHooks } from './rules.ts';
import { seedVulnerabilities } from './seed.ts';
import { registerSummary, takeSnapshot } from './summary.ts';

/**
 * Vulnerabilities: findings from scanners and assessments, tracked from first seen to fixed,
 * with a fix-by date from the severity policy, CSV import and a dashboard.
 * Findings are security records: every route also needs `security.view`.
 */

async function seedDefaults(ctx: ModuleContext) {
  await ctx.lookups.ensure('vulnerability_severity', [
    { value: 'critical', label: 'Critical', color: 'red', sort: 10 },
    { value: 'high', label: 'High', color: 'orange', sort: 20 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 30 },
    { value: 'low', label: 'Low', color: 'blue', sort: 40 },
    { value: 'informational', label: 'Informational', color: 'gray', sort: 50 },
  ]);
  // meta.closed: no longer counted as open. meta.fixed: sets "fixed on" and is what the import uses
  // to close and reopen. meta.acceptance: needs an exception or a justification and approver.
  // meta.reason: needs a false-positive reason.
  await ctx.lookups.ensure('vulnerability_status', [
    { value: 'open', label: 'Open', color: 'blue', sort: 10 },
    { value: 'in_remediation', label: 'In remediation', color: 'amber', sort: 20 },
    { value: 'fixed', label: 'Fixed', color: 'green', sort: 30, meta: { closed: true, fixed: true } },
    { value: 'risk_accepted', label: 'Risk accepted', color: 'purple', sort: 40, meta: { closed: true, acceptance: true } },
    { value: 'false_positive', label: 'False positive', color: 'gray', sort: 50, meta: { closed: true, reason: true } },
  ]);
}

async function register(ctx: ModuleContext) {
  ctx.defineResource({
    type: 'vulnerability', table: 'vulnerability_records', module: 'vulnerabilities',
    label: 'Vulnerability', plural: 'Vulnerabilities',
    path: '/api/vulnerabilities', route: '/vulnerabilities', titleField: 'title',
    ref: { field: 'ref', prefix: 'VUL-' },
    restricted: true,
    searchable: ['title', 'host_name', 'host_ip', 'plugin_id', 'cves', 'description'],
    defaultSort: { field: 'first_seen', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      host_name: { label: 'Host name', type: 'text' },
      host_ip: { label: 'IP address', type: 'text' },
      port: { label: 'Port', type: 'text' },
      service: { label: 'Service', type: 'text' },
      plugin_id: { label: 'Finding ID', type: 'text' },
      cves: { label: 'CVE', type: 'text' },
      severity: { label: 'Severity', type: 'lookup', list: 'vulnerability_severity', required: true },
      cvss: { label: 'CVSS score', type: 'number' },
      known_exploited: { label: 'Known exploited', type: 'boolean', default: false },
      first_seen: { label: 'First seen', type: 'date' },
      last_seen: { label: 'Last seen', type: 'date' },
      age_days: { label: 'Age (days)', type: 'number', readOnly: true },
      owner_id: { label: 'Owner', type: 'user' },
      system_id: { label: 'System', type: 'ref', to: 'system' },
      asset_id: { label: 'Asset', type: 'ref', to: 'asset' },
      status: { label: 'Status', type: 'lookup', list: 'vulnerability_status', default: 'open' },
      closed: { label: 'Closed', type: 'boolean', readOnly: true },
      due_on: { label: 'Fix by', type: 'date', readOnly: true },
      due_override_on: { label: 'Fix-by date override', type: 'date' },
      due_override_reason: { label: 'Reason for the override', type: 'text' },
      overdue: { label: 'Overdue', type: 'boolean', readOnly: true },
      fixed_on: { label: 'Fixed on', type: 'date' },
      exception_id: { label: 'Exception', type: 'ref', to: 'policy_exception' },
      acceptance_justification: { label: 'Risk acceptance justification', type: 'longtext' },
      acceptance_approver_id: { label: 'Risk acceptance approved by', type: 'user' },
      false_positive_reason: { label: 'False positive reason', type: 'longtext' },
      solution: { label: 'Solution', type: 'longtext' },
      remediation_notes: { label: 'Remediation notes', type: 'longtext' },
      source: { label: 'Source', type: 'text' },
      import_batch_id: { label: 'Import', type: 'text', readOnly: true },
      host_key: { label: 'Host (matching key)', type: 'text', readOnly: true },
    },
    hooks: findingHooks(ctx),
  });

  registerPolicy(ctx);
  registerSummary(ctx);
  registerImport(ctx);
  await takeSnapshot(ctx);
}

const mod: ModuleDef = {
  key: 'vulnerabilities',
  seedDefaults,
  register,
  seed: seedVulnerabilities,
};
export default mod;
