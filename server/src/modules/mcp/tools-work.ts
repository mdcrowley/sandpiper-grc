import { z } from 'zod';
import { dayInZone } from '../../core/timezone.ts';
import { qs } from './caller.ts';
import { fail, isUuid, plural, presentRow, rowLine, type ToolContext, type ToolSpec, type TypeMeta } from './toolkit.ts';

// Helpers that make an assistant useful to a transit IT, security and safety team: each one reads
// the module's own summary routes (or the generic list routes) with the caller's token.

const OPEN_ACTIONS = 'open,in_progress,blocked';

interface Section { key: string; label: string; total: number; rows: Record<string, unknown>[]; url?: string; note?: string }

/** Up to `size` records of a type matching filters, if the caller may see the type at all. */
async function listSection(t: ToolContext, key: string, label: string, typeKey: string, params: Record<string, unknown>, fields: string[], size = 10): Promise<Section | null> {
  const type = (await t.meta()).resources[typeKey] as TypeMeta | undefined;
  if (!type) return null;
  const res = await t.api.tryGet<{ rows: any[]; total: number }>(`${type.path}${qs({ ...params, pageSize: size })}`);
  if (!res) return null;
  const query = Object.entries(params).filter(([k]) => k.startsWith('f.') || k === 'sort' || k === 'dir');
  return {
    key, label, total: res.total,
    rows: res.rows.map((r) => presentRow(t, type, r, fields.filter((f) => type.fields[f]))),
    url: `${t.link(type.route)}${qs(Object.fromEntries(query))}`,
  };
}

function sectionText(s: Section, type?: TypeMeta): string {
  if (s.total === 0) return `${s.label}: none.`;
  const lines = s.rows.map((r) => (type ? rowLine(type, r) : `- ${r.ref ? `${r.ref} ` : ''}${r.title}`));
  return `${s.label}: ${s.total}${s.total > s.rows.length ? ` (first ${s.rows.length} shown)` : ''}\n${lines.join('\n')}`;
}

async function typeMeta(t: ToolContext, key: string) { return (await t.meta()).resources[key] as TypeMeta | undefined; }

const myWork: ToolSpec = {
  name: 'my_work', title: 'My work', group: 'Work and insight', idempotent: true,
  description: 'What is waiting for you: open tickets assigned to you, your open actions, changes waiting for your approval, '
    + 'policies waiting for your acknowledgement and unread notifications, soonest due first.',
  input: {},
  async run(_args, t) {
    const sections: Section[] = [];
    const tickets = await listSection(t, 'tickets', 'Open tickets assigned to you', 'ticket',
      { 'f.assignee_id': 'me', 'f.resolved_at.null': 'true', sort: 'resolve_due_at', dir: 'asc' }, ['status', 'priority', 'resolve_due_at']);
    if (tickets) sections.push(tickets);
    const actions = await listSection(t, 'actions', 'Your open actions', 'action',
      { 'f.owner_id': 'me', 'f.status': OPEN_ACTIONS, sort: 'due_on', dir: 'asc' }, ['status', 'priority', 'due_on', 'source']);
    if (actions) sections.push(actions);
    const change = await typeMeta(t, 'change');
    if (change && t.can('changes.approve')) {
      const waiting = await t.api.tryGet<{ rows: any[] }>('/api/changes/waiting');
      if (waiting) {
        sections.push({
          key: 'approvals', label: 'Changes waiting for your approval', total: waiting.rows.length,
          rows: waiting.rows.slice(0, 10).map((c) => ({ id: c.id, ref: c.ref, title: c.title, planned_start: c.planned_start, approvals: `${c.approvals_received} of ${c.approvals_required}`, url: t.link(change.route, c.id) })),
        });
      }
    }
    const acks = await t.api.tryGet<{ awaiting: any[] }>('/api/policies/acknowledgements/mine');
    if (acks) {
      sections.push({
        key: 'acknowledgements', label: 'Policies waiting for your acknowledgement', total: acks.awaiting.length,
        rows: acks.awaiting.slice(0, 10).map((a) => ({ id: a.id, ref: a.policy_ref, title: `${a.policy_title} (version ${a.version})`, due_on: a.due_on, state: a.state, url: `${t.baseUrl}/my-policies` })),
      });
    }
    const notes = await t.api.tryGet<{ rows: any[]; total: number }>('/api/notifications?unread=true&pageSize=10');
    if (notes) {
      sections.push({
        key: 'notifications', label: 'Unread notifications', total: notes.total,
        rows: notes.rows.map((n) => ({ id: n.id, title: n.title, at: n.created_at, ...(n.route ? { url: `${t.baseUrl}${n.route}` } : {}) })),
      });
    }
    const metaTypes = (await t.meta()).resources;
    const text = sections.map((s) => sectionText(s, s.key === 'tickets' ? metaTypes.ticket : s.key === 'actions' ? metaTypes.action : undefined)).join('\n\n');
    return { text: text || 'Nothing to show: none of the work lists are available to you.', data: { user: t.session.user.displayName, sections } };
  },
};

const overdueSummary: ToolSpec = {
  name: 'overdue_summary', title: 'Overdue summary', group: 'Work and insight', idempotent: true,
  description: 'Everything past its date that you may see, across the application: actions, tickets past their resolution target, '
    + 'vulnerabilities past their fix-by date, security incident notifications past their deadline, obligations and exercises past due, '
    + 'and risk reviews and safety investigations that are late. Counts with the oldest items first.',
  input: { per_kind: z.number().int().min(1).max(20).optional().describe('Items to show for each kind (default 5).') },
  async run(args, t) {
    const n = args.per_kind ?? 5;
    const today = dayInZone();
    const now = new Date().toISOString();
    const specs: [string, string, string, Record<string, unknown>, string[]][] = [
      ['actions', 'Actions', 'action', { 'f.due_on.lt': today, 'f.status': OPEN_ACTIONS, sort: 'due_on', dir: 'asc' }, ['owner_id', 'due_on', 'priority']],
      ['tickets', 'Tickets past their resolution target', 'ticket', { 'f.resolve_due_at.lt': now, 'f.resolved_at.null': 'true', sort: 'resolve_due_at', dir: 'asc' }, ['assignee_id', 'resolve_due_at', 'priority']],
      ['vulnerabilities', 'Vulnerabilities past their fix-by date', 'vulnerability', { 'f.due_on.lt': today, 'f.closed': 'false', sort: 'due_on', dir: 'asc' }, ['severity', 'owner_id', 'due_on']],
      ['notifications', 'Incident notifications past their deadline', 'notification_task', { 'f.due_at.lt': now, 'f.status': 'pending', sort: 'due_at', dir: 'asc' }, ['party', 'incident_id', 'due_at']],
      ['obligations', 'Obligations past due', 'obligation', { 'f.next_due_on.lt': today, sort: 'next_due_on', dir: 'asc' }, ['owner_id', 'next_due_on']],
      ['exercises', 'Exercises past due', 'exercise', { 'f.next_due_on.lt': today, sort: 'next_due_on', dir: 'asc' }, ['next_due_on']],
    ];
    const sections: Section[] = [];
    const meta = await t.meta();
    for (const [key, label, type, params, fields] of specs) {
      const def = meta.resources[type];
      // Only filters the type really has (installations differ).
      if (!def || Object.keys(params).some((p) => p.startsWith('f.') && !def.fields[p.slice(2).split('.')[0]])) continue;
      const s = await listSection(t, key, label, type, params, fields, n).catch(() => null);
      if (s) sections.push(s);
    }
    if (meta.resources.risk) {
      const risks = await t.api.tryGet<any>('/api/risks/summary');
      if (risks) sections.push({ key: 'risk_reviews', label: 'Risk reviews due', total: Number(risks.reviews_due ?? 0), rows: [], url: t.link('/risks') });
    }
    if (meta.resources.safety_event && t.can('safety.view')) {
      const safety = await t.api.tryGet<any>('/api/safety/summary');
      if (safety?.totals) sections.push({ key: 'safety_investigations', label: 'Safety investigations past due', total: Number(safety.totals.investigations_overdue ?? 0), rows: [] });
    }
    const total = sections.reduce((a, s) => a + s.total, 0);
    return {
      text: `Overdue as of ${today}: ${total} in all.\n\n${sections.map((s) => sectionText(s, meta.resources[{ actions: 'action', tickets: 'ticket', vulnerabilities: 'vulnerability', notifications: 'notification_task', obligations: 'obligation', exercises: 'exercise' }[s.key] ?? ''])).join('\n\n')}`,
      data: { today, total, sections },
    };
  },
};

const riskHeatmap: ToolSpec = {
  name: 'risk_heatmap', title: 'Risk heat map', group: 'Work and insight', idempotent: true,
  description: 'The open risks on a likelihood-by-impact matrix (residual by default), totals by rating, and the highest-rated risks. '
    + 'Needs permission to see risks, which are restricted records.',
  available: (a) => a.sees('risk'),
  input: {
    scale: z.string().optional().describe('Risk scale key, e.g. "cyber_5x5" (default) or "hazard_4x5".'),
    basis: z.enum(['residual', 'inherent']).optional().describe('Score after controls (residual, default) or before (inherent).'),
  },
  async run(args, t) {
    const h = await t.api.get<any>(`/api/risks/heatmap${qs({ scale: args.scale, basis: args.basis })}`);
    const L = [...h.scale.likelihood_levels].sort((a: any, b: any) => b.value - a.value);
    const I = [...h.scale.impact_levels].sort((a: any, b: any) => a.value - b.value);
    const cell = (l: number, i: number) => h.cells.find((c: any) => c.likelihood === l && c.impact === i);
    const grid = L.map((l: any) => `${String(l.label).padEnd(16).slice(0, 16)} | ${I.map((i: any) => String(cell(l.value, i.value)?.count ?? 0).padStart(3)).join(' ')}`);
    const top = h.risks.slice(0, 10).map((r: any) => ({ id: r.id, ref: r.ref, title: r.title, owner: r.owner_name, likelihood: r.likelihood, impact: r.impact, score: r.score, url: t.link('/risks', r.id) }));
    return {
      text: [
        `${h.scale.name ?? h.scale.key}, ${h.basis} scores: ${h.total} open risks, ${h.unscored} not scored.`,
        `Likelihood (rows, highest first) by impact (columns ${I.map((i: any) => i.value).join(' ')}):`,
        ...grid,
        `By rating: ${h.totals.map((x: any) => `${x.label} ${x.count}`).join(', ')}.`,
        top.length ? `Highest:\n${top.map((r: any) => `- ${r.ref} ${r.title} (score ${r.score ?? 'not scored'}, owner ${r.owner ?? 'none'})`).join('\n')}` : '',
      ].filter(Boolean).join('\n'),
      data: {
        scale: h.scale.key, basis: h.basis, total: h.total, unscored: h.unscored, totals: h.totals,
        cells: h.cells.map((c: any) => ({ likelihood: c.likelihood, impact: c.impact, rating: c.rating, count: c.count })),
        likelihood_levels: h.scale.likelihood_levels.map((l: any) => ({ value: l.value, label: l.label })),
        impact_levels: h.scale.impact_levels.map((l: any) => ({ value: l.value, label: l.label })),
        top_risks: top,
      },
    };
  },
};

const frameworkProgress: ToolSpec = {
  name: 'framework_progress', title: 'Framework progress', group: 'Work and insight', idempotent: true,
  description: 'How far each cybersecurity framework (or one, by name or id) has come: outcomes at target, the overall score, '
    + 'counts by status now and at each saved assessment.',
  available: (a) => a.sees('framework'),
  input: { framework: z.string().optional().describe('Framework name or id (default: all, up to 10).') },
  async run(args, t) {
    const list = await t.api.get<{ rows: any[] }>('/api/frameworks?pageSize=100');
    let fws = list.rows;
    if (args.framework) {
      const w = String(args.framework).toLowerCase();
      fws = fws.filter((f) => (isUuid(args.framework) ? f.id === args.framework : String(f.name ?? f.title ?? '').toLowerCase().includes(w)));
      if (!fws.length) fail(`No framework you can see matches "${args.framework}".`, 'not_found');
    }
    const out = [];
    for (const fw of fws.slice(0, 10)) {
      const p = await t.api.tryGet<any>(`/api/frameworks/${fw.id}/progress`);
      if (!p) continue;
      const now = p.series[p.series.length - 1];
      const label = (v: string) => p.statuses.find((s: any) => s.value === v)?.label ?? v;
      out.push({
        id: fw.id, name: p.framework.name ?? fw.name, outcomes: now.all.total, score: now.all.score, at_target: now.all.atTarget, at_target_pct: now.all.atTargetPct,
        target: p.target?.label ?? p.target?.value ?? null,
        by_status: Object.fromEntries(Object.entries(now.all.counts).map(([k, v]) => [label(k), v])),
        priority: { total: now.priority.total, at_target_pct: now.priority.atTargetPct },
        assessments: p.series.filter((s: any) => !s.current).map((s: any) => ({ name: s.name, date: s.date, score: s.all.score, at_target_pct: s.all.atTargetPct })),
        url: t.link('/frameworks', fw.id),
      });
    }
    return {
      text: out.length
        ? out.map((f) => `${f.name}: ${f.at_target} of ${f.outcomes} outcomes at target (${f.at_target_pct}%), score ${f.score}. By status: ${Object.entries(f.by_status).map(([k, v]) => `${k} ${v}`).join(', ')}.`
          + (f.assessments.length ? ` Last assessment "${f.assessments[f.assessments.length - 1].name}" (${f.assessments[f.assessments.length - 1].date}): ${f.assessments[f.assessments.length - 1].at_target_pct}% at target.` : '')).join('\n')
        : 'No frameworks to show.',
      data: { frameworks: out },
    };
  },
};

const incidentClocks: ToolSpec = {
  name: 'incident_clocks', title: 'Security incident clocks', group: 'Work and insight', idempotent: true,
  description: 'Open security incidents with their severity, status and lead, and every pending notification task (who must be told) with its deadline '
    + 'and the time left or overdue. Security incidents are restricted: this needs permission to see them.',
  available: (a) => a.sees('security_incident'),
  input: {},
  async run(_args, t) {
    const incidents = await t.api.get<{ rows: any[]; total: number }>(`/api/security-incidents${qs({ 'f.closed_at.null': 'true', sort: 'discovered_at', dir: 'asc', pageSize: 50 })}`);
    const tasks = (await typeMeta(t, 'notification_task'))
      ? await t.api.get<{ rows: any[] }>(`/api/notification-tasks${qs({ 'f.status': 'pending', sort: 'due_at', dir: 'asc', pageSize: 100 })}`)
      : { rows: [] };
    const now = Date.now();
    const left = (due: string | null) => {
      if (!due) return 'no deadline';
      const ms = Date.parse(due) - now;
      const h = Math.round(Math.abs(ms) / 3_600_000);
      const text = h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`;
      return ms < 0 ? `overdue by ${text}` : `${text} left`;
    };
    const list = incidents.rows.map((i) => ({
      id: i.id, ref: i.ref, title: i.title, severity: i._display?.severity ?? i.severity, status: i._display?.status ?? i.status,
      lead: i._display?.lead_id ?? null, discovered_at: i.discovered_at, contained_at: i.contained_at,
      notifications: tasks.rows.filter((n) => n.incident_id === i.id).map((n) => ({
        id: n.id, party: n.party, required: n.required, due_at: n.due_at, time: left(n.due_at), overdue: !!n.due_at && Date.parse(n.due_at) < now,
      })),
      url: t.link('/security-incidents', i.id),
    }));
    const overdue = tasks.rows.filter((n) => n.due_at && Date.parse(n.due_at) < now).length;
    return {
      text: list.length
        ? `${plural(list.length, 'open security incident')}; ${plural(tasks.rows.length, 'pending notification')} (${overdue} overdue).\n`
          + list.map((i) => `- ${i.ref} ${i.title} [${i.severity}, ${i.status}${i.lead ? `, lead ${i.lead}` : ''}]`
            + (i.notifications.length ? `\n${i.notifications.map((n) => `    notify ${n.party}${n.required ? '' : ' (recommended)'}: ${n.time}`).join('\n')}` : '')).join('\n')
        : 'No open security incidents.',
      data: { incidents: list, pending_notifications: tasks.rows.length, overdue_notifications: overdue },
    };
  },
};

const contractsNearingNotice: ToolSpec = {
  name: 'contracts_nearing_notice', title: 'Contracts nearing their notice date', group: 'Work and insight', idempotent: true,
  description: 'Contracts whose notice date (the last day to give notice before renewal or expiry) falls within the next N days or has just passed, '
    + 'soonest first, with vendor, value, owner and how they renew. Also counts active contracts with no notice date recorded.',
  available: (a) => a.sees('contract'),
  input: { days: z.number().int().min(1).max(730).optional().describe('Look this many days ahead (default 90).') },
  async run(args, t) {
    const days = args.days ?? 90;
    const r = await t.api.get<any>('/api/contracts/renewals');
    const rows = r.contracts.filter((c: any) => c.days_to_notice <= days && c.days_to_notice >= -30).map((c: any) => ({
      id: c.id, ref: c.ref, title: c.title, vendor: c.vendor_name, notice_date: c.notice_date, days_to_notice: c.days_to_notice,
      end_date: c.end_date, renewal: c.renewal_label, value: c.total_value, owner: c.owner_name, status: c.status_label, url: t.link('/contracts', c.id),
    }));
    return {
      text: rows.length
        ? `${plural(rows.length, 'contract')} with a notice date within ${days} days (or passed in the last 30):\n`
          + rows.map((c: any) => `- ${c.ref ?? ''} ${c.title}${c.vendor ? ` (${c.vendor})` : ''}: notice ${c.notice_date}, ${c.days_to_notice < 0 ? `passed ${-c.days_to_notice} days ago` : `${c.days_to_notice} days left`}${c.renewal ? `, ${c.renewal}` : ''}`).join('\n')
          + (r.undated.length ? `\n${plural(r.undated.length, 'active contract')} have no notice date.` : '')
        : `No contract reaches its notice date in the next ${days} days.${r.undated.length ? ` ${plural(r.undated.length, 'active contract')} have no notice date.` : ''}`,
      data: { today: r.today, days, contracts: rows, without_notice_date: r.undated.length },
    };
  },
};

const vulnerabilitySummary: ToolSpec = {
  name: 'vulnerability_summary', title: 'Vulnerability summary', group: 'Work and insight', idempotent: true,
  description: 'Open and overdue vulnerabilities by severity, known-exploited and unassigned counts, ageing, mean time to fix, the worst hosts and who holds the overdue ones. '
    + 'Vulnerabilities are restricted records: this needs permission to see them.',
  available: (a) => a.sees('vulnerability'),
  input: {},
  async run(_args, t) {
    const s = await t.api.get<any>('/api/vulnerabilities/summary');
    const sev = (k: string) => s.severities.find((x: any) => x.value === k)?.label ?? k;
    const bySev = (list: any[]) => list.filter((x) => x.count).map((x) => `${sev(x.severity)} ${x.count}`).join(', ') || 'none';
    return {
      text: [
        `Open: ${s.totals.open} (${bySev(s.openBySeverity)}). Overdue: ${s.totals.overdue} (${bySev(s.overdueBySeverity)}).`,
        `Known exploited and open: ${s.totals.knownExploitedOpen}. Unassigned: ${s.totals.unassignedOpen}. Fixed this month: ${s.totals.fixedThisMonth}.`,
        `Age: ${s.ageBuckets.map((b: any) => `${b.label} ${b.total}`).join(', ')}.`,
        s.topHosts.length ? `Worst hosts: ${s.topHosts.slice(0, 5).map((h: any) => `${h.host} (${h.total})`).join(', ')}.` : '',
        s.overdueByOwner.length ? `Overdue by owner: ${s.overdueByOwner.map((o: any) => `${o.owner} ${o.count}`).join(', ')}.` : '',
      ].filter(Boolean).join('\n'),
      data: {
        today: s.today, totals: s.totals, open_by_severity: s.openBySeverity, overdue_by_severity: s.overdueBySeverity,
        age: s.ageBuckets.map((b: any) => ({ label: b.label, total: b.total })), mean_days_to_fix: s.mttr, top_hosts: s.topHosts, overdue_by_owner: s.overdueByOwner,
        url: t.link('/vulnerabilities'),
      },
    };
  },
};

const serviceDeskMetrics: ToolSpec = {
  name: 'service_desk_metrics', title: 'Service desk metrics', group: 'Work and insight', idempotent: true,
  description: 'Service desk figures for tickets opened in a date range (all time by default): volume, open and resolved, average first response and resolution, '
    + 'service-level compliance and breaches, satisfaction, backlog by age, and the busiest categories and priorities.',
  available: (a) => a.sees('ticket'),
  input: {
    from: z.string().optional().describe('First day, YYYY-MM-DD.'),
    to: z.string().optional().describe('Last day, YYYY-MM-DD.'),
  },
  async run(args, t) {
    const m = await t.api.get<any>(`/api/tickets/metrics${qs({ from: args.from, to: args.to })}`);
    const mins = (v: number | null) => (v === null ? 'n/a' : v >= 1440 ? `${Math.round(v / 144) / 10} days` : v >= 60 ? `${Math.round(v / 6) / 10} hours` : `${Math.round(v)} minutes`);
    const top = (list: any[]) => list.slice(0, 5).map((x) => `${x.label} ${x.count}`).join(', ');
    return {
      text: [
        `Tickets ${args.from || args.to ? `opened ${args.from ?? 'any time'} to ${args.to ?? 'now'}` : 'all time'}: ${m.total} (${m.open} open, ${m.resolved} resolved).`,
        `Average first response ${mins(m.first_response.average_minutes)}; average resolution ${mins(m.resolution.average_minutes)}.`,
        `Service levels met: ${m.sla.compliance_pct ?? 'n/a'}% (response ${m.sla.response.compliance_pct ?? 'n/a'}%, resolution ${m.sla.resolve.compliance_pct ?? 'n/a'}%); ${m.sla.breaches} breached.`,
        `Satisfaction: ${m.satisfaction.average ?? 'n/a'} from ${m.satisfaction.count} responses. Held with vendors: ${m.vendor.held}.`,
        `Backlog by age: ${m.backlog.buckets.map((b: any) => `${b.label} ${b.count}`).join(', ')}.`,
        `By category: ${top(m.by_category)}. By priority: ${top(m.by_priority)}.`,
      ].join('\n'),
      data: {
        range: m.range, total: m.total, open: m.open, resolved: m.resolved, first_response: m.first_response, resolution: m.resolution, sla: m.sla,
        satisfaction: m.satisfaction, vendor: m.vendor, backlog: m.backlog,
        by_category: m.by_category, by_priority: m.by_priority, by_status: m.by_status, url: t.link('/tickets'),
      },
    };
  },
};

const fleetEquipmentGaps: ToolSpec = {
  name: 'fleet_equipment_gaps', title: 'Fleet equipment gaps', group: 'Work and insight', idempotent: true,
  description: 'Vehicles in service that lack working required on-board equipment (for example a radio, camera system or fare validator), by mode and depot, '
    + 'and which equipment types are most often missing. Available when the fleet module is part of this installation.',
  available: (a) => a.can('fleet.view') && a.sees('vehicle'),
  input: {
    mode: z.string().optional().describe('Vehicle mode value(s), comma-separated, e.g. "bus".'),
  },
  async run(args, t) {
    const c = await t.api.get<any>(`/api/fleet/coverage${qs({ mode: args.mode, gaps: 'true' })}`);
    const typeLabel = (v: string) => c.columns.find((x: any) => x.value === v)?.label ?? v;
    const vehicles = c.vehicles.slice(0, 50).map((v: any) => ({
      id: v.id, fleet_number: v.fleet_number, mode: v.mode_label, depot: v.depot_name, status: v.status_label,
      missing: Object.entries(v.cells).filter(([, s]) => s === 'missing').map(([k]) => typeLabel(k)),
      not_working: Object.entries(v.cells).filter(([, s]) => s === 'not_working').map(([k]) => typeLabel(k)),
      url: t.link('/fleet/vehicles', v.id),
    }));
    return {
      text: `${c.summary.vehicles} vehicles in scope: ${c.summary.fully_equipped} fully equipped, ${c.summary.with_gaps} with a gap.\n`
        + `By equipment: ${c.columns.map((x: any) => `${x.label} missing ${x.missing}, not working ${x.not_working}`).join('; ')}.\n`
        + vehicles.slice(0, 20).map((v: any) => `- ${v.fleet_number} (${v.mode}${v.depot ? `, ${v.depot}` : ''}): ${[...v.missing.map((m: string) => `no ${m}`), ...v.not_working.map((m: string) => `${m} not working`)].join(', ')}`).join('\n'),
      data: { summary: c.summary, equipment: c.columns, vehicles },
    };
  },
};

const safetySummary: ToolSpec = {
  name: 'safety_summary', title: 'Safety summary', group: 'Work and insight', idempotent: true,
  description: 'The safety picture for the last twelve months: safety events (and serious ones), open events and late investigations, corrective actions, '
    + 'open hazards and high-rated ones, and each safety performance indicator against its target. Available when the safety module is part of this installation.',
  available: (a) => a.can('safety.view') && a.sees('safety_event'),
  input: {},
  async run(_args, t) {
    const s = await t.api.get<any>('/api/safety/summary');
    const tt = s.totals;
    const indicators = (s.indicators ?? []).map((i: any) => {
      const v = i.latest?.value ?? null;
      // The same rule as the safety module: "at most" (the default) or "at least" the target.
      const on = v === null || i.target === null ? null : i.target_direction === 'at_least' ? v >= i.target : v <= i.target;
      return { name: i.name, latest: v, period: i.latest?.period ?? null, target: i.target, direction: i.target_direction, on_target: on };
    });
    return {
      text: [
        `Last 12 months: ${tt.events} safety events, ${tt.serious} serious or worse. Open: ${tt.open} (${tt.investigations_overdue} investigations overdue).`,
        `Corrective actions: ${tt.corrective_open} open, ${tt.corrective_overdue} overdue. Hazards: ${tt.hazards_open} open, ${tt.hazards_high} rated high, ${tt.hazards_review_overdue} past review.`,
        indicators.length ? `Indicators: ${indicators.map((i: any) => `${i.name} ${i.latest ?? 'no data'}${i.target !== null ? ` (target ${i.target}, ${i.on_target === null ? 'n/a' : i.on_target ? 'on target' : 'off target'})` : ''}`).join('; ')}.` : '',
      ].filter(Boolean).join('\n'),
      data: { today: s.today, totals: tt, by_month: s.by_month, indicators, url: t.link('/safety') },
    };
  },
};

const runReportTool: ToolSpec = {
  name: 'run_report', title: 'Run a saved report', group: 'Work and insight', idempotent: true,
  description: 'Runs a saved report (by id or name) shared with you and returns its result as rows of labelled values, with the total number of matching records. '
    + 'Without "report", lists the saved reports you can run.',
  available: (a) => a.sees('report_definition'),
  input: {
    report: z.string().optional().describe('Report id or (part of its) name.'),
    max_rows: z.number().int().min(1).max(200).optional().describe('Most rows to return (default 50).'),
  },
  async run(args, t) {
    const all = await t.api.get<{ rows: any[] }>('/api/reports?pageSize=200&sort=name&dir=asc');
    if (!args.report) {
      const reports = all.rows.map((r) => ({ id: r.id, name: r.name, record_type: r.record_type, description: r.description ?? null }));
      return { text: reports.length ? `${plural(reports.length, 'saved report')}:\n${reports.map((r) => `- ${r.name} (${r.record_type})`).join('\n')}` : 'No saved reports you can run.', data: { reports } };
    }
    const w = String(args.report).toLowerCase();
    const found = isUuid(args.report) ? all.rows.find((r) => r.id === args.report)
      : all.rows.find((r) => String(r.name).toLowerCase() === w) ?? all.rows.find((r) => String(r.name).toLowerCase().includes(w));
    if (!found) fail(`No saved report you can run matches "${args.report}". Call run_report with no report to list them.`, 'not_found');
    const ran = await t.api.get<any>(`/api/reports/${found.id}/run`);
    const res = ran.result;
    const max = args.max_rows ?? 50;
    const rows = res.rows.slice(0, max).map((r: any) => Object.fromEntries(res.columns.map((c: any) => [c.label ?? c.key, r.d?.[c.key] ?? r.v?.[c.key] ?? null])));
    const header = res.columns.map((c: any) => c.label ?? c.key);
    return {
      text: `${ran.report.name}: ${res.total} matching ${res.plural?.toLowerCase() ?? 'records'}${res.rows.length > max || res.truncated ? `, first ${Math.min(max, res.rows.length)} rows shown` : ''}.\n`
        + [header.join(' | '), ...rows.slice(0, 25).map((r: any) => header.map((h: string) => String(r[h] ?? '')).join(' | '))].join('\n'),
      data: { report: ran.report, mode: res.mode, record_type: res.type, total: res.total, columns: header, rows, truncated: res.truncated || res.rows.length > max, url: t.link('/reports', found.id) },
    };
  },
};

export const WORK_TOOLS: ToolSpec[] = [
  myWork, overdueSummary, riskHeatmap, frameworkProgress, incidentClocks, contractsNearingNotice,
  vulnerabilitySummary, serviceDeskMetrics, fleetEquipmentGaps, safetySummary, runReportTool,
];
