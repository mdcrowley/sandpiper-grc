// Findings worked as one (E45-36): the same finding (scanner id, else CVE list, else title: the
// `finding_key`) seen on several hosts is one row of the "By finding" view, with each host's
// finding below it; bulk assign, accept and close; and "Raise a change" for one finding or many,
// linked both ways through record links.
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { pageOf } from '../../core/api/conventions.ts';
import { hasSystems, secured } from './policy.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
export const MAX_BULK = 500;

/** Fields a bulk action may set: owner, status and what the status dialogs ask for. */
export const BULK_FIELDS = [
  'owner_id', 'status', 'exposure', 'fixed_on', 'remediation_notes', 'exception_id', 'acceptance_justification', 'acceptance_approver_id', 'false_positive_reason',
];

function idsOf(ctx: ModuleContext, raw: unknown, what: string): string[] {
  const ids = Array.isArray(raw) ? [...new Set(raw.map(String))] : [];
  if (!ids.length || ids.some((id) => !UUID.test(id))) ctx.fail(400, 'validation', `Choose the findings ${what}.`, { ids: 'Give at least one finding.' });
  if (ids.length > MAX_BULK) ctx.fail(400, 'validation', `At most ${MAX_BULK} findings at a time.`, { ids: `At most ${MAX_BULK}.` });
  return ids;
}

const messageOf = (err: unknown): string => {
  const e = err as { message?: string; fields?: Record<string, string> };
  const fields = e?.fields ? Object.values(e.fields).filter(Boolean) : [];
  return [e?.message, ...fields].filter(Boolean).join(' ') || 'Not saved.';
};

export function registerGroups(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = secured(ctx, 'vulnerabilities.view');
  const edit = secured(ctx, 'vulnerabilities.edit');

  /** Severity values worst first, from the order of the severity list. */
  const severityOrder = async () => (await ctx.lookups.values('vulnerability_severity')).map((s) => s.value);

  /**
   * ?status=open (default: groups with an open finding) | all; ?multi=true: only findings on more than
   * one host; ?q= text in the title, finding ID or CVE; page, pageSize.
   */
  app.get('/api/vulnerabilities/groups', { preHandler: view }, async (req) => {
    const q = req.query as Row;
    const { page, pageSize } = pageOf(q, { size: 50, maxSize: 200 });
    const params: unknown[] = [];
    const where = [`v.deleted_at is null`, `v.finding_key <> ''`, ctx.resources.visibleWhere('vulnerability', req.user, 'v')];
    const text = String(q.q ?? '').trim();
    if (text) {
      params.push(`%${text.toLowerCase()}%`);
      where.push(`(lower(v.title) like $${params.length} or lower(coalesce(v.plugin_id, '')) like $${params.length} or lower(coalesce(v.cves, '')) like $${params.length})`);
    }
    const having: string[] = [];
    if (q.status !== 'all') having.push('count(*) filter (where not v.closed) > 0');
    if (q.multi === 'true') having.push(`count(distinct v.host_key) filter (where v.host_key <> '') > 1`);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.query<Row>(
      `select g.*, count(*) over () as total from (
         select v.finding_key,
                max(v.plugin_id) as plugin_id, max(v.cves) as cves,
                (array_agg(v.title order by v.closed, v.last_seen desc nulls last))[1] as title,
                count(distinct v.host_key) filter (where v.host_key <> '')::int as hosts,
                count(*) filter (where not v.closed)::int as open,
                count(*) filter (where v.closed)::int as closed,
                count(*) filter (where v.overdue)::int as overdue,
                count(*) filter (where not v.closed and v.owner_id is null)::int as unassigned,
                min(v.first_seen) filter (where not v.closed) as oldest_seen,
                max(v.age_days) filter (where not v.closed) as oldest_age,
                min(v.due_on) filter (where not v.closed) as earliest_due,
                coalesce(bool_or(v.known_exploited and not v.closed), false) as known_exploited,
                coalesce(max(v.urgency), 0)::float8 as urgency,
                array_agg(distinct v.severity) filter (where not v.closed) as open_severities,
                array_agg(distinct v.severity) as severities
         from vulnerability_records v
         where ${where.join(' and ')}
         group by v.finding_key
         ${having.length ? `having ${having.join(' and ')}` : ''}
       ) g
       order by g.urgency desc, g.open desc, g.hosts desc, g.title
       limit $${params.length - 1} offset $${params.length}`, params);
    const order = await severityOrder();
    const worst = (list: string[] | null) => (list ?? []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? null;
    return {
      total: Number(rows[0]?.total ?? 0), page, pageSize,
      rows: rows.map(({ total: _t, open_severities, severities, ...g }) => ({
        ...g, key: g.finding_key, oldest_seen: day(g.oldest_seen), earliest_due: day(g.earliest_due),
        severity: worst(open_severities) ?? worst(severities),
      })),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vulnerabilities/groups', tag: 'Vulnerabilities', permission: 'vulnerabilities.view',
    summary: 'Findings grouped by finding ID (else CVE, else title): hosts, open and closed counts, worst severity, oldest and earliest fix-by date',
    description: 'Also needs `security.view`. Query: `status=open|all`, `multi=true` (only findings on more than one host), `q`, `page`, `pageSize`. Most urgent first.',
  });

  /** ?key=<finding key>: every finding in one group, one per host and port. */
  app.get('/api/vulnerabilities/group', { preHandler: view }, async (req) => {
    const key = String((req.query as Row).key ?? '');
    if (!key) ctx.fail(400, 'validation', 'Name the finding (key).');
    const rows = await db.query<Row>(
      `select v.id, v.ref, v.title, v.host_name, v.host_ip, v.port, v.protocol, v.severity, v.status, v.closed, v.overdue, v.urgency,
              v.known_exploited, v.exposure, v.first_seen, v.last_seen, v.due_on, v.fixed_on, v.age_days, v.owner_id, u.display_name as owner_name,
              v.system_id, v.asset_id, v.plugin_id, v.cves, v.solution, v.description
       from vulnerability_records v left join users u on u.id = v.owner_id
       where v.deleted_at is null and v.finding_key = $1 and ${ctx.resources.visibleWhere('vulnerability', req.user, 'v')}
       order by v.closed, v.urgency desc, coalesce(v.host_name, v.host_ip), v.port`, [key]);
    if (!rows.length) ctx.fail(404, 'not_found', 'No findings with this identifier.');
    const statuses = await ctx.lookups.values('vulnerability_status');
    const systems = hasSystems(ctx) && ctx.can(req.user, 'systems.view');
    const findings = [];
    for (const r of rows) {
      findings.push({
        ...r, solution: undefined, description: undefined,
        first_seen: day(r.first_seen), last_seen: day(r.last_seen), due_on: day(r.due_on), fixed_on: day(r.fixed_on),
        status_label: statuses.find((s) => s.value === r.status)?.label ?? r.status,
        system_label: systems && r.system_id ? await ctx.resources.labelFor('system', r.system_id) : null,
      });
    }
    const first = rows.find((r) => !r.closed) ?? rows[0];
    return {
      key, title: first.title, plugin_id: first.plugin_id, cves: first.cves, solution: first.solution, description: first.description,
      open: rows.filter((r) => !r.closed).length, hosts: new Set(rows.map((r) => r.host_name || r.host_ip)).size, findings,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vulnerabilities/group', tag: 'Vulnerabilities', permission: 'vulnerabilities.view',
    summary: 'The findings of one group (one per host and port) with their status, owner and fix-by date',
    description: 'Also needs `security.view`. Query: `key`, the group key from `GET /api/vulnerabilities/groups`.',
  });

  /** Body: { ids, patch }. Saves the same change on each finding, one by one, with every rule; reports what failed. */
  app.post('/api/vulnerabilities/bulk', { preHandler: edit }, async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Row;
    const ids = idsOf(ctx, b.ids, 'to change');
    const raw = (b.patch && typeof b.patch === 'object' ? b.patch : {}) as Row;
    const patch = Object.fromEntries(Object.entries(raw).filter(([k]) => BULK_FIELDS.includes(k)));
    if (!Object.keys(patch).length) ctx.fail(400, 'validation', `Say what to change: ${BULK_FIELDS.join(', ')}.`, { patch: 'Nothing to change.' });
    let updated = 0;
    const failed: Row[] = [];
    for (const id of ids) {
      const row = await ctx.resources.find('vulnerability', id, req.user);
      if (!row) { failed.push({ id, ref: null, message: 'Finding not found.' }); continue; }
      try {
        await ctx.resources.update('vulnerability', id, { ...patch }, req);
        updated++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status && status >= 500) throw err;
        failed.push({ id, ref: row.ref, message: messageOf(err), fields: (err as { fields?: unknown }).fields ?? null });
      }
    }
    return { updated, failed };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vulnerabilities/bulk', tag: 'Vulnerabilities', permission: 'vulnerabilities.edit',
    summary: 'Assign, accept or close several findings at once',
    description: `Also needs \`security.view\`. Body: \`{ ids, patch }\`; \`patch\` may set ${BULK_FIELDS.map((f) => `\`${f}\``).join(', ')}. Each finding is saved with every rule (risk acceptance, lifecycle); the answer lists those that were not saved and why.`,
  });

  /** Body: { ids }. Creates a draft change that fixes these findings, linked to each; open findings move to In remediation. */
  app.post('/api/vulnerabilities/raise-change', { preHandler: view }, async (req: FastifyRequest, reply) => {
    if (!ctx.resources.get('change')) ctx.fail(404, 'not_found', 'Changes are not available in this installation.');
    if (!ctx.can(req.user, 'changes.create')) ctx.fail(403, 'forbidden', 'You do not have permission to create changes.');
    const ids = idsOf(ctx, (req.body as Row | undefined)?.ids, 'the change fixes');
    const found: Row[] = [];
    for (const id of ids) {
      const row = await ctx.resources.find('vulnerability', id, req.user);
      if (!row) ctx.fail(404, 'not_found', 'One of the findings was not found.');
      found.push(row!);
    }
    found.sort((a, b) => Number(b.urgency ?? 0) - Number(a.urgency ?? 0));
    const keys = new Set(found.map((f) => f.finding_key));
    const hosts = [...new Set(found.map((f) => f.host_name || f.host_ip).filter(Boolean))];
    const lead = found[0];
    const title = keys.size === 1
      ? `Fix: ${lead.title}${hosts.length > 1 ? ` on ${hosts.length} hosts` : hosts.length ? ` on ${hosts[0]}` : ''}`
      : `Fix ${found.length} vulnerability findings${hosts.length ? ` on ${hosts.length} host${hosts.length === 1 ? '' : 's'}` : ''}`;
    const line = (f: Row) => `- ${f.ref}: ${f.title}${f.host_name || f.host_ip ? ` (${[f.host_name || f.host_ip, f.port].filter(Boolean).join(', port ')})` : ''}${f.due_on ? `, fix by ${day(f.due_on)}` : ''}`;
    const solutions = [...new Set(found.map((f) => String(f.solution ?? '').trim()).filter(Boolean))].slice(0, 3);
    const description = [
      `Fixes ${found.length === 1 ? 'this finding' : `these ${found.length} findings`}:`, ...found.map(line),
      ...(solutions.length ? ['', 'Solution given by the scanner:', ...solutions] : []),
    ].join('\n').slice(0, 20000);
    const sevs = [...new Set(found.map((f) => f.severity))];
    const reason = `Vulnerability remediation (${sevs.join(', ')} severity${found.some((f) => f.known_exploited) ? ', known exploited' : ''}${found.some((f) => f.overdue) ? ', past its fix-by date' : ''}).`;
    const data: Row = { title: title.slice(0, 250), description, reason };
    const systemIds = [...new Set(found.map((f) => f.system_id).filter(Boolean))];
    if (systemIds.length === 1 && ctx.resources.get('system') && ctx.can(req.user, 'systems.view')) data.system_id = systemIds[0];
    const assetIds = [...new Set(found.map((f) => f.asset_id).filter(Boolean))];
    if (assetIds.length === 1 && ctx.resources.get('asset') && ctx.can(req.user, 'assets.view')) data.asset_id = assetIds[0];
    const change = await ctx.resources.create('change', data, req);
    const actor = actorOf(req).id;
    for (const f of found) {
      await db.query(
        `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ('change', $1, 'vulnerability', $2, 'fixes', $3)
         on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [change.id, f.id, actor]);
      await ctx.audit(req, {
        action: 'vulnerability.change_raised', recordType: 'vulnerability', recordId: f.id,
        summary: `Change ${change.ref ?? ''} raised to fix this finding`.replace('  ', ' '), after: { change_id: change.id, change_ref: change.ref },
      });
    }
    let started = 0;
    if (ctx.can(req.user, 'vulnerabilities.edit')) {
      for (const f of found.filter((x) => x.status === 'open')) {
        try { await ctx.resources.update('vulnerability', f.id, { status: 'in_remediation' }, req); started++; } catch { /* a lifecycle rule may forbid it: the link is enough */ }
      }
    }
    reply.code(201);
    return { id: change.id, ref: change.ref, route: `/changes/${change.id}`, linked: found.length, started };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vulnerabilities/raise-change', tag: 'Vulnerabilities', permission: 'vulnerabilities.view',
    summary: 'Raise a draft change that fixes one or more findings, linked to each of them',
    description: 'Also needs `security.view` and `changes.create`. Body: `{ ids }`. The change names the findings, hosts and fix-by dates and takes their system when they share one; open findings move to In remediation when the caller may edit findings.',
  });
}
