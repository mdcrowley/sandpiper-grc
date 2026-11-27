import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { addDays, today } from './policy.ts';
import { keysFor } from './rules.ts';
import { takeSnapshot } from './summary.ts';

/**
 * Invented sample findings and their back-filled weekly trend, dev profile only (E18-69), marked
 * "[Sample]" in their source.
 * Idempotent: a finding is only added when no finding with the same host and identifier exists.
 */

export const SAMPLE_SOURCE = '[Sample] Monthly network scan';

// [host name, address, sample asset it stands for, sample system (dev estate) when there is no asset]
const HOSTS: [string, string, string | null, string | null][] = [
  ['ws-frontdesk-01', '10.20.1.11', '[Sample] Front desk workstation 1', null],
  ['ws-frontdesk-02', '10.20.1.12', '[Sample] Front desk workstation 2', null],
  ['lt-finance-03', '10.20.1.23', '[Sample] Finance laptop', null],
  ['srv-files-01', '10.20.5.10', '[Sample] File server', null],
  ['sw-core-01', '10.20.0.2', '[Sample] Core switch', null],
  ['fw-warehouse-01', '10.20.8.1', '[Sample] Warehouse firewall', null],
  ['rt-branch-01', '10.20.9.1', '[Sample] Branch router 1', null],
  ['srv-payments-01', '10.20.5.20', '[Sample] Payments server', null],
  ['cam-recorder-01', '10.20.7.5', '[Sample] Camera recorder', null],
  ['prn-office-01', '10.20.1.90', '[Sample] Office printer', null],
  ['srv-web-01', '10.20.6.10', null, 'Example Public Website'],
  ['srv-db-01', '10.20.5.30', null, 'Example Finance System'],
];

// [finding id, title, severity, CVSS, port, service, invented CVE or '', solution]
const FINDINGS: [string, string, string, number, string, string, string, string][] = [
  ['900101', 'Remote code execution in file sharing service', 'critical', 9.8, '445/tcp', 'smb', 'CVE-2099-0101', 'Install the vendor security update and restart the service.'],
  ['900102', 'Operating system no longer receives security updates', 'critical', 10, '', '', '', 'Upgrade to a supported release or isolate the host.'],
  ['900103', 'Default administrator password accepted', 'critical', 9.1, '443/tcp', 'https', '', 'Set a unique password and restrict the management interface.'],
  ['900104', 'Authentication bypass in web management console', 'high', 8.6, '8443/tcp', 'https', 'CVE-2099-0104', 'Apply the firmware update that fixes the console.'],
  ['900105', 'Remote desktop reachable without network-level authentication', 'high', 7.5, '3389/tcp', 'rdp', '', 'Require network-level authentication and limit who can connect.'],
  ['900106', 'Database version has known vulnerabilities', 'high', 8.1, '5432/tcp', 'database', 'CVE-2099-0106', 'Upgrade the database to the current minor release.'],
  ['900107', 'Missing security updates (two or more months behind)', 'high', 7.8, '', '', 'CVE-2099-0107', 'Install outstanding updates and check the update schedule.'],
  ['900108', 'Message signing not required on file sharing', 'medium', 5.3, '445/tcp', 'smb', '', 'Require signing on servers and clients.'],
  ['900109', 'Weak cipher suites accepted', 'medium', 5.9, '443/tcp', 'https', '', 'Disable legacy protocol versions and weak ciphers.'],
  ['900110', 'Certificate has expired', 'medium', 5.3, '443/tcp', 'https', '', 'Renew and install the certificate.'],
  ['900111', 'Default community string on network management service', 'medium', 6.5, '161/udp', 'snmp', '', 'Change the community string or move to the authenticated version.'],
  ['900112', 'Cross-site scripting in web application', 'medium', 6.1, '443/tcp', 'https', 'CVE-2099-0112', 'Apply the application update and encode output.'],
  ['900113', 'Weak key exchange algorithms on remote shell', 'medium', 4.8, '22/tcp', 'ssh', '', 'Remove legacy key exchange algorithms from the configuration.'],
  ['900114', 'Firmware update available with security fixes', 'medium', 6.8, '', '', 'CVE-2099-0114', 'Schedule the firmware update in a maintenance window.'],
  ['900115', 'Directory listing enabled on web server', 'low', 3.7, '80/tcp', 'http', '', 'Turn off directory listing.'],
  ['900116', 'Self-signed certificate in use', 'low', 3.1, '443/tcp', 'https', '', 'Install a certificate from the organization\'s certificate authority.'],
  ['900117', 'Web server discloses its version', 'low', 2.6, '80/tcp', 'http', '', 'Hide the version banner.'],
  ['900118', 'Clickjacking protection header missing', 'low', 3.1, '443/tcp', 'https', '', 'Send a frame-ancestors policy.'],
  ['900119', 'Anonymous file transfer enabled', 'low', 3.9, '21/tcp', 'ftp', '', 'Disable anonymous access or the service.'],
  ['900120', 'Timestamp response reveals system clock', 'informational', 0, '', 'icmp', '', 'No action needed unless policy says otherwise.'],
  ['900121', 'Open ports summary', 'informational', 0, '', '', '', 'Review against the expected services for this host.'],
];
const AGES = [3, 8, 14, 21, 35, 50, 75, 120, 210];

export async function seedVulnerabilities(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  // Invented samples only: a pilot installation starts with no pretend findings or trend (E18-69).
  if (opts.profile !== 'dev') return 'nothing to load (sample findings are dev profile only)';
  const now = today();
  const idByName = async (type: string, table: string, name: string | null): Promise<string | null> => {
    if (!name || !ctx.resources.get(type)) return null;
    return (await ctx.db.one<{ id: string }>(`select id from ${table} where lower(name) = lower($1) and deleted_at is null`, [name]))?.id ?? null;
  };
  // Some samples get an owner, so the "by owner" numbers have something to show.
  const user = await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`).catch(() => undefined);

  let created = 0;
  let total = 0;
  let exploited = 0;
  for (const [h, [hostName, hostIp, assetName, systemName]] of HOSTS.entries()) {
    const assetId = await idByName('asset', 'assets', assetName);
    const asset = assetId ? await ctx.db.one<Row>('select system_id from assets where id = $1', [assetId]) : undefined;
    const systemId = ctx.resources.get('system') ? asset?.system_id ?? await idByName('system', 'systems', systemName) : null;
    for (const [t, [pluginId, title, severity, cvss, port, service, cve, solution]] of FINDINGS.entries()) {
      if ((h * 7 + t * 3) % 4 !== 0) continue;
      total++;
      const data: Row = { host_name: hostName, host_ip: hostIp, plugin_id: pluginId, title };
      const key = keysFor(data);
      if (await ctx.db.one('select 1 from vulnerabilities where host_key = $1 and finding_key = $2 and deleted_at is null', [key.host_key, key.finding_key])) continue;

      const age = AGES[(h * 13 + t * 29) % AGES.length];
      const firstSeen = addDays(now, -age);
      const kind = (h + t * 5) % 10;
      Object.assign(data, {
        severity, cvss, port: port || null, service: service || null, cves: cve || null, solution,
        description: `${title}. Reported by the sample scan of ${hostName}; invented data for demonstration.`,
        first_seen: firstSeen, last_seen: addDays(now, -(t % 3)), source: SAMPLE_SOURCE,
        asset_id: assetId, system_id: systemId,
        // E45-38: exposure feeds the urgency order; the first sample host faces the internet.
        exposure: h === 0 ? 'internet' : h % 4 === 3 ? 'isolated' : 'internal',
      });
      if (kind <= 1) {
        // Fixed: some this month, some earlier, never before the day after first seen.
        const fixedOn = addDays(firstSeen, Math.max(1, Math.min(age - 1, 4 + ((h + t) % 5) * 6)));
        Object.assign(data, { status: 'fixed', fixed_on: fixedOn, last_seen: fixedOn, remediation_notes: 'Fixed and confirmed by a follow-up scan.' });
      } else if (kind === 2) {
        Object.assign(data, { status: 'in_remediation', remediation_notes: 'Update scheduled for the next maintenance window.' });
      } else if (severity === 'low' && kind === 7 && h % 2 === 0) {
        Object.assign(data, { status: 'false_positive', false_positive_reason: 'The service reported is a test page that holds no data.' });
      }
      if (!data.status && exploited < 2 && (severity === 'critical' || severity === 'high') && age < 60) {
        data.known_exploited = true;
        exploited++;
      }
      if (user && (h + t) % 3 === 0) data.owner_id = user.id;
      await ctx.resources.create('vulnerability', data);
      created++;
    }
  }

  // Several weeks of trend, worked out from the sample findings' own dates. Existing weeks are kept.
  const sample = await ctx.db.query<Row>(
    `select severity, first_seen, fixed_on, due_on, closed from vulnerabilities where deleted_at is null and source = $1`, [SAMPLE_SOURCE],
  );
  const monday = (await ctx.db.one<{ d: string }>(`select date_trunc('week', current_date)::date as d`))!.d;
  let weeks = 0;
  for (let w = 10; w >= 1; w--) {
    const weekStart = addDays(monday, -7 * w);
    const weekEnd = addDays(weekStart, 6);
    const counts = new Map<string, { open: number; overdue: number }>();
    for (const f of sample) {
      const openThen = f.first_seen <= weekEnd && (f.fixed_on ? f.fixed_on > weekEnd : !f.closed);
      if (!openThen) continue;
      const c = counts.get(f.severity) ?? { open: 0, overdue: 0 };
      c.open++;
      if (f.due_on && f.due_on < weekEnd) c.overdue++;
      counts.set(f.severity, c);
    }
    for (const [severity, c] of counts) {
      const res = await ctx.db.query(
        `insert into vulnerability_snapshots (week_start, severity, open_count, overdue_count) values ($1,$2,$3,$4)
         on conflict (week_start, severity) do nothing returning 1`,
        [weekStart, severity, c.open, c.overdue],
      );
      if (res.length) weeks++;
    }
  }
  await takeSnapshot(ctx);
  return `sample findings ${total} on ${HOSTS.length} hosts (${created} new), trend snapshot rows ${weeks} new`;
}
