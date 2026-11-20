import { featureState, optionName, optionOn } from '../../core/features.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

/** Canned inventory reports. Each returns plain rows that the web page renders as a table. */

interface Column { key: string; label: string; type?: 'text' | 'date' | 'number' | 'currency' }
interface ReportDef {
  key: string;
  title: string;
  description: string;
  /** Every permission listed is needed. The first decides who may export. */
  perms: string[];
  /** Record type each row opens, when it has one. */
  recordType: 'asset' | 'system' | 'site' | null;
  /** Heading the report sits under on the page. */
  group: 'Assets' | 'Systems';
  /** A count of rows is a list of things to fix ('issues') or simply a breakdown ('summary'). */
  kind: 'issues' | 'summary';
  /** The same rows as a filtered list page, when the list's filters can express the report. */
  list?: () => Promise<string>;
  columns: Column[];
  run(user: SessionUser | null, query: Record<string, string>): Promise<Row[]>;
}

const ACTIVE = `a.deleted_at is null and coalesce(a.status, '') not in ('retired', 'disposed')`;

export function registerReports(ctx: ModuleContext) {
  const { app, db } = ctx;

  const labels = async (list: string) => new Map((await ctx.lookups.values(list)).map((v) => [v.value, v.label]));
  const assetSelect = `a.id, a.tag, a.name, a.asset_type, a.status, a.make, a.model, a.serial, a.department,
    a.location, a.warranty_end, a.support_end, a.assigned_to_name, s.name as site, u.display_name as user_name`;
  const assetFrom = `from assets a
    left join sites s on s.id = a.site_id and s.deleted_at is null
    left join users u on u.id = a.user_id`;

  async function assetRows(user: SessionUser | null, where: string, order: string, params: unknown[] = []): Promise<Row[]> {
    const rows = await db.query<Row>(`select ${assetSelect} ${assetFrom} where ${where} order by ${order}`, params);
    const types = await labels('asset_type');
    const statuses = await labels('asset_status');
    const showSites = ctx.can(user, 'sites.view');
    return rows.map((r) => ({
      ...r,
      route: `/assets/${r.id}`,
      site: showSites ? r.site : null,
      asset_type: types.get(r.asset_type) ?? r.asset_type,
      status: statuses.get(r.status) ?? r.status,
      assigned_to: r.user_name ?? r.assigned_to_name,
    }));
  }

  const assetColumns: Column[] = [
    { key: 'tag', label: 'Tag' },
    { key: 'name', label: 'Name' },
    { key: 'asset_type', label: 'Type' },
    { key: 'status', label: 'Status' },
    { key: 'site', label: 'Site' },
    { key: 'assigned_to', label: 'Assigned to' },
  ];
  const systemColumns: Column[] = [
    { key: 'ref', label: 'Reference' },
    { key: 'name', label: 'System' },
    { key: 'system_group', label: 'Group' },
    { key: 'vendor_name', label: 'Vendor' },
    { key: 'criticality', label: 'Criticality' },
  ];

  async function systemRows(where: string, params: unknown[] = []): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select y.id, y.ref, y.name, y.system_group, y.vendor_name, y.criticality_tier, y.status, y.mfa_status,
              y.rto_hours, y.rpo_hours, y.authentication_method,
              bo.display_name as business_owner, tech.display_name as technical_owner
       from systems y
       left join users bo on bo.id = y.business_owner_id
       left join users tech on tech.id = y.technical_owner_id
       where y.deleted_at is null and coalesce(y.status, '') <> 'retired' and ${where}
       order by y.criticality_tier nulls last, y.name`,
      params,
    );
    const tiers = await labels('criticality_tier');
    const mfa = await labels('mfa_status');
    return rows.map((r) => ({
      ...r,
      route: `/systems/${r.id}`,
      criticality: tiers.get(r.criticality_tier) ?? null,
      mfa: mfa.get(r.mfa_status) ?? r.mfa_status ?? 'Not recorded',
    }));
  }

  /** Statuses of assets still held, as a list filter. */
  const heldFilter = async () => {
    const held = (await ctx.lookups.values('asset_status')).map((v) => v.value).filter((v) => v !== 'retired' && v !== 'disposed');
    return `f.status=${held.join(',')}`;
  };
  const plusDays = (days: number) => todayInZone(new Date(Date.now() + days * 86_400_000));

  const reports: ReportDef[] = [
    {
      key: 'assets-past-support', title: 'Assets past support',
      description: 'Assets still held whose support end date has passed.',
      perms: ['assets.view'], recordType: 'asset', group: 'Assets', kind: 'issues',
      list: async () => `/assets?${await heldFilter()}&f.support_end.lt=${todayInZone()}&sort=support_end&dir=asc`,
      columns: [...assetColumns, { key: 'support_end', label: 'Support ended', type: 'date' }, { key: 'days_past', label: 'Days past', type: 'number' }],
      run: async (user) => (await assetRows(user, `${ACTIVE} and a.support_end < $1::date`, 'a.support_end, a.tag', [todayInZone()]))
        .map((r) => ({ ...r, days_past: daysBetween(r.support_end, null) })),
    },
    {
      key: 'warranty-expiring', title: 'Warranty expiring',
      description: 'Assets whose warranty ends in the next 90 days.',
      perms: ['assets.view'], recordType: 'asset', group: 'Assets', kind: 'issues',
      list: async () => `/assets?${await heldFilter()}&f.warranty_end.gt=${plusDays(-1)}&f.warranty_end.lt=${plusDays(91)}&sort=warranty_end&dir=asc`,
      columns: [...assetColumns, { key: 'warranty_end', label: 'Warranty ends', type: 'date' }, { key: 'days_left', label: 'Days left', type: 'number' }],
      run: async (user, query) => {
        const days = Math.min(730, Math.max(1, Number(query.days) || 90));
        const rows = await assetRows(
          user, `${ACTIVE} and a.warranty_end >= $2::date and a.warranty_end <= $2::date + $1::int`, 'a.warranty_end, a.tag', [days, todayInZone()],
        );
        return rows.map((r) => ({ ...r, days_left: daysBetween(null, r.warranty_end) }));
      },
    },
    {
      key: 'assets-by-site', title: 'Assets by site',
      description: 'How many assets are held at each site, with their recorded cost. Disposed assets are left out.',
      perms: ['assets.view', 'sites.view'], recordType: 'site', group: 'Assets', kind: 'summary',
      columns: [
        { key: 'site', label: 'Site' },
        { key: 'assets', label: 'Assets', type: 'number' },
        { key: 'in_use', label: 'In use', type: 'number' },
        { key: 'funder_interest', label: 'With funder interest', type: 'number' },
        { key: 'cost', label: 'Recorded cost', type: 'currency' },
      ],
      run: async () => {
        const rows = await db.query<Row>(
          `select s.id, coalesce(s.name, 'No site recorded') as site, count(*)::int as assets,
                  count(*) filter (where a.status = 'in_use')::int as in_use,
                  count(*) filter (where a.funder_interest)::int as funder_interest,
                  coalesce(sum(a.cost), 0) as cost
           from assets a left join sites s on s.id = a.site_id and s.deleted_at is null
           where a.deleted_at is null and coalesce(a.status, '') <> 'disposed'
           group by s.id, s.name order by s.name nulls last`,
        );
        return rows.map((r) => ({ ...r, route: r.id ? `/sites/${r.id}` : null }));
      },
    },
    {
      key: 'assets-by-department', title: 'Assets by department',
      description: 'How many assets each department holds, with their recorded cost. Disposed assets are left out.',
      perms: ['assets.view'], recordType: null, group: 'Assets', kind: 'summary',
      columns: [
        { key: 'department', label: 'Department' },
        { key: 'assets', label: 'Assets', type: 'number' },
        { key: 'in_use', label: 'In use', type: 'number' },
        { key: 'funder_interest', label: 'With funder interest', type: 'number' },
        { key: 'cost', label: 'Recorded cost', type: 'currency' },
      ],
      run: () => db.query<Row>(
        `select coalesce(nullif(trim(a.department), ''), 'No department recorded') as department, count(*)::int as assets,
                count(*) filter (where a.status = 'in_use')::int as in_use,
                count(*) filter (where a.funder_interest)::int as funder_interest,
                coalesce(sum(a.cost), 0) as cost
         from assets a
         where a.deleted_at is null and coalesce(a.status, '') <> 'disposed'
         group by 1 order by (nullif(trim(max(a.department)), '') is null), 1`,
      ),
    },
    {
      key: 'unassigned-assets', title: 'Unassigned assets',
      description: 'Assets that are not retired or disposed and have no user or named person assigned.',
      perms: ['assets.view'], recordType: 'asset', group: 'Assets', kind: 'issues',
      list: async () => `/assets?${await heldFilter()}&f.user_id.null=true&f.assigned_to_name.null=true`,
      columns: [...assetColumns.filter((c) => c.key !== 'assigned_to'), { key: 'department', label: 'Department' }, { key: 'location', label: 'Location' }],
      run: (user) => assetRows(user, `${ACTIVE} and a.user_id is null and coalesce(trim(a.assigned_to_name), '') = ''`, 'a.status, a.tag'),
    },
    {
      key: 'systems-without-owner', title: 'Systems without an owner',
      description: 'Systems with no business owner or no technical owner recorded.',
      perms: ['systems.view'], recordType: 'system', group: 'Systems', kind: 'issues',
      columns: [...systemColumns, { key: 'business_owner', label: 'Business owner' }, { key: 'technical_owner', label: 'Technical owner' }, { key: 'missing', label: 'Missing' }],
      run: async () => (await systemRows('(y.business_owner_id is null or y.technical_owner_id is null)')).map((r) => ({
        ...r,
        missing: [!r.business_owner && 'Business owner', !r.technical_owner && 'Technical owner'].filter(Boolean).join(', '),
      })),
    },
    {
      key: 'systems-without-recovery-targets', title: 'Systems without recovery targets',
      description: 'Systems with no recovery time objective or no recovery point objective.',
      perms: ['systems.view'], recordType: 'system', group: 'Systems', kind: 'issues',
      columns: [
        ...systemColumns,
        { key: 'rto_hours', label: 'Recovery time (hours)', type: 'number' },
        { key: 'rpo_hours', label: 'Recovery point (hours)', type: 'number' },
        { key: 'missing', label: 'Missing' },
      ],
      run: async () => (await systemRows('(y.rto_hours is null or y.rpo_hours is null)')).map((r) => ({
        ...r,
        missing: [r.rto_hours === null && 'Recovery time objective', r.rpo_hours === null && 'Recovery point objective'].filter(Boolean).join(', '),
      })),
    },
    {
      key: 'sensitive-data-without-mfa', title: 'Systems holding sensitive data without multi-factor',
      description: 'Systems that hold a confidential, restricted or not yet classified data category and do not enforce multi-factor sign-in.',
      perms: ['systems.view', 'data.view'], recordType: 'system', group: 'Systems', kind: 'issues',
      columns: [...systemColumns, { key: 'mfa', label: 'Multi-factor' }, { key: 'authentication_method', label: 'Authentication' }, { key: 'data_categories', label: 'Sensitive data held' }],
      run: () => sensitiveWithoutMfa(),
    },
  ];

  // Sensitive = any linked category not classified as a non-sensitive level (unclassified counts).
  async function sensitiveWithoutMfa(): Promise<Row[]> {
    const insensitive = (await ctx.lookups.values('sensitivity_level')).filter((v) => v.meta?.sensitive === false).map((v) => v.value);
    const satisfied = (await ctx.lookups.values('mfa_status')).filter((v) => v.meta?.satisfied === true).map((v) => v.value);
    const held = await db.query<{ system_id: string; names: string }>(
      `select l.system_id, string_agg(d.name, '; ' order by d.name) as names
       from system_data_categories l join data_categories d on d.id = l.data_category_id and d.deleted_at is null
       where d.sensitivity_level is null or not (d.sensitivity_level = any($1::text[]))
       group by l.system_id`,
      [insensitive],
    );
    if (!held.length) return [];
    const names = new Map(held.map((h) => [h.system_id, h.names]));
    const rows = await systemRows(`y.id = any($1::uuid[]) and not (coalesce(y.mfa_status, '') = any($2::text[]))`, [[...names.keys()], satisfied]);
    return rows.map((r) => ({ ...r, data_categories: names.get(r.id) }));
  }

  const allowed = (user: SessionUser | null, r: ReportDef) => r.perms.every((p) => ctx.can(user, p));

  /** A report's columns now: the funder-interest count follows that option (Administration > Features; E18-28). */
  const columnsOf = async (r: ReportDef): Promise<Column[]> => {
    if (!r.columns.some((c) => c.key === 'funder_interest')) return r.columns;
    const state = await featureState(db);
    if (!optionOn(state, 'funder_interest')) return r.columns.filter((c) => c.key !== 'funder_interest');
    const name = optionName(state, 'funder_interest');
    return r.columns.map((c) => (c.key === 'funder_interest' ? { ...c, label: `With ${/^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name}` } : c));
  };

  const info = async (r: ReportDef) => ({
    key: r.key, title: r.title, description: r.description, columns: await columnsOf(r), recordType: r.recordType,
    group: r.group, kind: r.kind, list: r.list ? await r.list() : null,
  });

  /** The reports the caller may see, each with its row count now (`total`). */
  app.get('/api/inventory/reports', async (req) => {
    const out: Row[] = [];
    for (const r of reports.filter((x) => allowed(req.user, x))) {
      out.push({ ...(await info(r)), total: (await r.run(req.user, {})).length });
    }
    return out;
  });

  app.get('/api/inventory/reports/:key', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    const report = reports.find((r) => r.key === key) ?? ctx.fail(404, 'not_found', 'Report not found.');
    if (!allowed(req.user, report)) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    const query = req.query as Record<string, string>;
    const rows = await report.run(req.user, query);

    if (query.format === 'csv') {
      const exportPerm = `${report.perms[0].split('.')[0]}.export`;
      if (!ctx.can(req.user, exportPerm)) ctx.fail(403, 'forbidden', 'You do not have permission to export this report.');
      const columns = await columnsOf(report);
      const lines = [columns.map((c) => csvCell(c.label)).join(',')];
      for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.key])).join(','));
      await ctx.audit(req, { action: 'report.export', recordType: 'report', summary: `Exported report "${report.title}" (${rows.length} rows) to CSV` });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="${report.key}.csv"`);
      return '﻿' + lines.join('\r\n');
    }
    return {
      ...(await info(report)), rows, total: rows.length,
      generatedAt: new Date().toISOString(),
    };
  });
}

/** Whole days from `from` to `to`; a null end means today in the organization's time zone. Dates are 'YYYY-MM-DD'. */
function daysBetween(from: string | Date | null, to: string | Date | null): number {
  const midnight = (s: string | Date | null) => {
    const ymd = s === null ? todayInZone() : s instanceof Date ? s.toISOString().slice(0, 10) : String(s).slice(0, 10);
    return Date.parse(`${ymd}T00:00:00Z`);
  };
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
