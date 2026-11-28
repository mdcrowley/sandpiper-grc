// The standard dashboards, saved reports and starter pack the seed creates. They are data, not
// code: plain specifications that are resolved when someone opens them, so a widget whose module
// is not loaded simply says so. Nothing here names an organization, a person or a product.
import type { Row } from '../../core/module.ts';
import type { Condition, FilterGroup, ReportSpec } from './spec.ts';

const all = (...items: (Condition | FilterGroup)[]): FilterGroup => ({ op: 'and', items });
const c = (field: string, op: string, value?: unknown): Condition => ({ field, op, value });

type W = Row;
const number = (id: string, x: number, y: number, title: string, type: string, filters: FilterGroup | undefined, extra: Row = {}, w = 3): W =>
  ({ id, kind: 'number', title, x, y, w, h: 2, config: { spec: { type, filters }, ...extra } });
const chart = (id: string, x: number, y: number, w: number, h: number, title: string, kind: string, spec: ReportSpec, extra: Row = {}): W =>
  ({ id, kind: 'chart', title, x, y, w, h, config: { spec, chart: { kind }, ...extra } });
const list = (id: string, x: number, y: number, w: number, h: number, title: string, spec: ReportSpec, extra: Row = {}): W =>
  ({ id, kind: 'list', title, x, y, w, h, config: { spec, ...extra } });
const text = (id: string, x: number, y: number, w: number, h: number, title: string, markdown: string): W =>
  ({ id, kind: 'text', title, x, y, w, h, config: { markdown } });

// Filters used more than once.
const openTickets = all(c('resolved_at', 'empty'), c('status', 'nin', ['cancelled', 'closed', 'resolved']));
const openActions = all(c('status', 'nin', ['done', 'cancelled']));
const overdueActions = all(c('status', 'nin', ['done', 'cancelled']), c('due_on', 'past'));
const openIncidents = all(c('closed_at', 'empty'));
const openVulns = all(c('closed', 'false'));
const activeProjects = all(c('status', 'in', ['active', 'on_hold']));
const DATE = [{ kind: 'date', label: 'Dates' }];
const ON_VEHICLE = ['onboard_computer', 'cad_avl_unit', 'farebox', 'validator', 'vehicle_router', 'camera', 'radio', 'passenger_info_display'];

/**
 * The Board summary (wave 26, E46): an organization-wide page with safety at the top, then operations
 * (vehicles, inspections, emergencies and continuity plans), then service, risk, technology and projects.
 * Each line is one fact; a line whose area is switched off is left out of the page by the dashboard itself.
 */
const openSafetyEvents = all(c('status', 'nin', ['closed']));
const BOARD_SUMMARY_DESCRIPTION = 'One page in plain language for leadership: safety first, then operations, service, risk and projects, with arrows showing which way each figure is moving.';
/** The Board summary as it shipped in wave 26, before the safety indicators (E46-68); an unedited one is upgraded. */
const BOARD_SUMMARY_WAVE26: W[] = [
  text('t0', 0, 0, 12, 2, 'About this page', 'Each line below is one fact about the organization, written without jargon, most important first. The arrow compares the **last 30 days** with the 30 days before. Select any figure to see the records behind it.'),
  number('b1', 0, 2, 'Safety events', 'safety_event', all(c('occurred_at', 'last_days', 30)), { sentence: '{value} safety {event was|events were} recorded in the last 30 days.', trend: { field: 'occurred_at', days: 30, filters: null, upIsGood: false, noun: 'were recorded' } }, 6),
  number('b2', 6, 2, 'Serious safety events', 'safety_event', all(c('severity', 'in', ['serious', 'major']), c('occurred_at', 'last_days', 90)), { sentence: '{value} serious or major safety {event|events} in the last 90 days.', tone: 'bad', trend: null }, 6),
  number('b3', 0, 4, 'Hazards', 'hazard', all(c('rating', 'in', ['serious', 'high']), c('status', 'nin', ['closed'])), { sentence: '{value} open {hazard is|hazards are} rated serious or high.', tone: 'bad', trend: { field: 'created_at', days: 30, upIsGood: false, noun: 'were added' } }, 6),
  number('b4', 6, 4, 'Safety investigations', 'safety_event', all(c('investigation_due', 'past'), openSafetyEvents), { sentence: '{value} safety {investigation is|investigations are} past {its|their} due date.', tone: 'bad', trend: null }, 6),
  chart('b5', 0, 6, 12, 4, 'Safety events each month, by type', 'stacked', { type: 'safety_event', groupBy: [{ field: 'occurred_at', bucket: 'month' }, { field: 'event_type' }], filters: all(c('occurred_at', 'last_days', 365)) }, { dateField: 'occurred_at' }),
  number('o1', 0, 10, 'Vehicles', 'vehicle', all(c('status', 'in', ['out_of_service', 'in_maintenance'])), { sentence: '{value} {vehicle is|vehicles are} out of service or in maintenance.', trend: null }, 6),
  number('o2', 6, 10, 'Inspections', 'inspection', all(c('status', 'in', ['missed']), c('due_on', 'last_days', 90)), { sentence: '{value} {inspection was|inspections were} missed in the last 90 days.', tone: 'bad', trend: null }, 6),
  number('o3', 0, 12, 'Emergencies', 'emergency_activation', all(c('status', 'in', ['active'])), { sentence: '{value} emergency {activation is|activations are} active.', tone: 'bad', trend: null }, 6),
  number('o4', 6, 12, 'Continuity plans', 'continuity_plan', all(c('next_review_on', 'past'), c('status', 'nin', ['retired'])), { sentence: '{value} continuity {plan is|plans are} past {its|their} review date.', tone: 'bad', trend: null }, 6),
  number('s1', 0, 14, 'Service', 'ticket', openTickets, { sentence: '{value} {request or fault is|requests and faults are} open with the service desk.', trend: { field: 'opened_at', days: 30, filters: null, upIsGood: false, noun: 'were raised' } }, 6),
  number('s2', 6, 14, 'Follow-up actions', 'action', overdueActions, { sentence: '{value} agreed {action is|actions are} past {its|their} due date.', tone: 'bad', trend: { field: 'completed_on', days: 30, filters: null, upIsGood: true, noun: 'were completed' } }, 6),
  number('s4', 0, 16, 'Risk', 'risk', all(c('summary_level', 'in', ['high', 'critical'])), { sentence: '{value} {risk is|risks are} rated high or critical.', tone: 'bad', trend: { field: 'created_at', days: 30, upIsGood: false, noun: 'were added' } }, 6),
  number('s3', 6, 16, 'Security incidents', 'security_incident', openIncidents, { sentence: '{value} security {incident is|incidents are} being handled.', tone: 'bad', trend: { field: 'discovered_at', days: 30, filters: null, upIsGood: false, noun: 'were discovered' } }, 6),
  number('s5', 0, 18, 'Known weaknesses', 'vulnerability', all(c('closed', 'false'), c('overdue', 'true')), { sentence: '{value} known {weakness|weaknesses} in our systems {has|have} not been fixed in the time we allow.', tone: 'bad', trend: { field: 'fixed_on', days: 30, filters: null, upIsGood: true, noun: 'were fixed' } }, 6),
  number('s6', 6, 18, 'Suppliers', 'contract', all(c('notice_date', 'next_days', 120)), { sentence: '{value} supplier {contract reaches its|contracts reach their} notice date in the next four months.', trend: null }, 6),
  number('s7', 0, 20, 'Projects', 'project', all(c('rag_overall', 'in', ['red']), c('status', 'in', ['active', 'on_hold'])), { sentence: '{value} {project is|projects are} rated red: {it needs|they need} a decision or help.', tone: 'bad', trend: null }, 6),
  { id: 'p1', kind: 'progress', title: 'Security framework: priority outcomes largely met or met', x: 6, y: 20, w: 6, h: 2, config: { spec: { type: 'framework_outcome', filters: all(c('priority', 'true'), c('status', 'in', ['largely_met', 'met'])) }, of: all(c('priority', 'true')) } },
  chart('c1', 0, 22, 6, 4, 'Projects by overall rating', 'donut', { type: 'project', filters: activeProjects, groupBy: [{ field: 'rag_overall' }] }),
  chart('c2', 6, 22, 6, 4, 'Requests and faults raised each month', 'bar', { type: 'ticket', groupBy: [{ field: 'opened_at', bucket: 'month' }], filters: all(c('opened_at', 'last_days', 365)) }, { dateField: 'opened_at' }),
];

/**
 * Wave 27 (E46-68): where each safety performance indicator stands, under the safety events: how many
 * missed their target in their latest complete month, and one line per indicator. The figures come from
 * the safety module (widget-sources.ts); the widgets name `safety_indicator` as their type, so the page
 * leaves them out while the safety area is off.
 */
const SAFETY_INDICATOR_WIDGETS: W[] = [
  { id: 'b6', kind: 'number', title: 'Safety performance indicators', x: 0, y: 10, w: 12, h: 2, config: { source: 'safety_indicators', spec: { type: 'safety_indicator' }, sentence: '{value} safety performance {indicator|indicators} missed {its|their} target in the latest complete month.', tone: 'bad', trend: null } },
  { id: 'b7', kind: 'table', title: 'Where each safety indicator stands', x: 0, y: 12, w: 12, h: 6, config: { source: 'safety_indicators', spec: { type: 'safety_indicator' } } },
];
const BOARD_SUMMARY_WIDGETS: W[] = [
  ...BOARD_SUMMARY_WAVE26.filter((w) => w.y < 10),
  ...SAFETY_INDICATOR_WIDGETS,
  ...BOARD_SUMMARY_WAVE26.filter((w) => w.y >= 10).map((w) => ({ ...w, y: w.y + 8 })),
];

/**
 * The change success rate of the IT leadership overview. Wave 27 (E46-54): the same figure as the home
 * widget, from the changes module (widget-sources.ts), so a change that caused an incident counts as not
 * successful. Before, it counted outcomes only (`CHANGE_SUCCESS_GAUGE_BEFORE`; an unedited one is upgraded).
 */
const CHANGE_SUCCESS_GAUGE: W = { id: 'g2', kind: 'gauge', title: 'Change success rate', x: 9, y: 14, w: 3, h: 4, config: { source: 'change_success', spec: { type: 'change' }, target: 95 } };
export const CHANGE_SUCCESS_GAUGE_BEFORE: W = { id: 'g2', kind: 'gauge', title: 'Change success rate', x: 9, y: 14, w: 3, h: 4, config: { spec: { type: 'change', filters: all(c('outcome', 'in', ['successful', 'successful_with_issues'])) }, of: all(c('outcome', 'in', ['successful', 'successful_with_issues', 'failed', 'backed_out'])), target: 95, dateField: 'actual_end' } };

/** Earlier standard Board summaries, oldest first: one still reading exactly like any of them is brought up to the current one. */
export const BOARD_SUMMARY_EARLIER = (): { description: string; widgets: W[] }[] => [
  BOARD_SUMMARY_BEFORE,
  { description: BOARD_SUMMARY_DESCRIPTION, widgets: BOARD_SUMMARY_WAVE26 },
];

/**
 * The Board summary as it shipped before wave 26 (technology and security only). An installation whose
 * board summary still reads exactly like this, and so was never edited, is brought up to the current one
 * when the application starts (`refreshBoardSummary` in seed.ts); an edited one is left alone.
 */
export const BOARD_SUMMARY_BEFORE: { description: string; widgets: W[] } = {
  description: 'One page in plain language, with arrows showing which way each figure is moving.',
  widgets: [
      text('t0', 0, 0, 12, 2, 'About this page', 'Each line below is one fact about technology and security, written without jargon. The arrow compares the **last 30 days** with the 30 days before. Select any figure to see the records behind it.'),
      number('s1', 0, 2, 'Service', 'ticket', openTickets, { sentence: '{value} {request or fault is|requests and faults are} open with the IT team.', trend: { field: 'opened_at', days: 30, filters: null, upIsGood: false, noun: 'were raised' } }, 6),
      number('s2', 6, 2, 'Follow-up actions', 'action', overdueActions, { sentence: '{value} agreed {action is|actions are} past {its|their} due date.', tone: 'bad', trend: { field: 'completed_on', days: 30, filters: null, upIsGood: true, noun: 'were completed' } }, 6),
      number('s3', 0, 4, 'Security incidents', 'security_incident', openIncidents, { sentence: '{value} security {incident is|incidents are} being handled.', tone: 'bad', trend: { field: 'discovered_at', days: 30, filters: null, upIsGood: false, noun: 'were discovered' } }, 6),
      number('s4', 6, 4, 'Risk', 'risk', all(c('summary_level', 'in', ['high', 'critical'])), { sentence: '{value} {risk is|risks are} rated high or critical.', tone: 'bad', trend: { field: 'created_at', days: 30, upIsGood: false, noun: 'were added' } }, 6),
      number('s5', 0, 6, 'Known weaknesses', 'vulnerability', all(c('closed', 'false'), c('overdue', 'true')), { sentence: '{value} known {weakness|weaknesses} in our systems {has|have} not been fixed in the time we allow.', tone: 'bad', trend: { field: 'fixed_on', days: 30, filters: null, upIsGood: true, noun: 'were fixed' } }, 6),
      number('s6', 6, 6, 'Suppliers', 'contract', all(c('notice_date', 'next_days', 120)), { sentence: '{value} supplier {contract reaches its|contracts reach their} notice date in the next four months.', trend: null }, 6),
      { id: 'p1', kind: 'progress', title: 'Security framework: priority outcomes largely met or met', x: 0, y: 8, w: 6, h: 2, config: { spec: { type: 'framework_outcome', filters: all(c('priority', 'true'), c('status', 'in', ['largely_met', 'met'])) }, of: all(c('priority', 'true')) } },
      number('s7', 6, 8, 'Projects', 'project', all(c('rag_overall', 'in', ['red']), c('status', 'in', ['active', 'on_hold'])), { sentence: '{value} {project is|projects are} rated red: {it needs|they need} a decision or help.', tone: 'bad', trend: null }, 6),
      chart('c1', 0, 10, 6, 4, 'Projects by overall rating', 'donut', { type: 'project', filters: activeProjects, groupBy: [{ field: 'rag_overall' }] }),
      chart('c2', 6, 10, 6, 4, 'Requests and faults raised each month', 'bar', { type: 'ticket', groupBy: [{ field: 'opened_at', bucket: 'month' }], filters: all(c('opened_at', 'last_days', 365)) }, { dateField: 'opened_at' }),
  ],
};

export interface StandardDashboard { key: string; name: string; description: string; filters: Row[]; widgets: W[]; refresh_seconds?: number }

export const STANDARD_DASHBOARDS: StandardDashboard[] = [
  {
    key: 'cio_overview', name: 'IT leadership overview',
    description: 'The position across service, security, vendors and projects on one page.',
    filters: [...DATE, { kind: 'department', label: 'Department' }, { kind: 'owner', label: 'Owner' }],
    widgets: [
      number('n1', 0, 0, 'Open tickets', 'ticket', openTickets, { icon: 'ticket', trend: { field: 'opened_at', days: 30, filters: null, upIsGood: false, noun: 'opened' } }),
      number('n2', 3, 0, 'Overdue actions', 'action', overdueActions, { icon: 'check-square', tone: 'bad' }),
      number('n3', 6, 0, 'Open security incidents', 'security_incident', openIncidents, { icon: 'shield', tone: 'bad' }),
      number('n4', 9, 0, 'Projects in flight', 'project', activeProjects, { icon: 'folder' }),
      chart('c1', 0, 2, 8, 4, 'Tickets opened each week', 'line', { type: 'ticket', groupBy: [{ field: 'opened_at', bucket: 'week' }], filters: all(c('opened_at', 'last_days', 90)) }, { dateField: 'opened_at' }),
      chart('c2', 8, 2, 4, 4, 'Projects by overall rating', 'donut', { type: 'project', filters: activeProjects, groupBy: [{ field: 'rag_overall' }] }),
      chart('c3', 0, 6, 4, 4, 'Risks by level', 'bar', { type: 'risk', groupBy: [{ field: 'summary_level' }] }),
      chart('c4', 4, 6, 4, 4, 'Framework outcomes by status', 'hbar', { type: 'framework_outcome', groupBy: [{ field: 'status' }] }),
      chart('c5', 8, 6, 4, 4, 'Open actions by priority', 'bar', { type: 'action', filters: openActions, groupBy: [{ field: 'priority' }] }),
      list('l1', 0, 10, 6, 4, 'Contract notice dates coming up', { type: 'contract', columns: ['title', 'vendor_id', 'notice_date'], filters: all(c('notice_date', 'next_days', 180)), sort: [{ by: 'notice_date', dir: 'asc' }] }, { dateField: 'notice_date' }),
      list('l2', 6, 10, 6, 4, 'Changes planned', { type: 'change', columns: ['title', 'status', 'planned_start'], filters: all(c('planned_start', 'next_days', 30)), sort: [{ by: 'planned_start', dir: 'asc' }] }, { dateField: 'planned_start' }),
      // Wave 25 (E45-45): vulnerability age, service levels and change success.
      chart('c6', 0, 14, 6, 4, 'Open vulnerabilities by age and severity', 'stacked', { type: 'vulnerability', filters: openVulns, groupBy: [{ field: 'first_seen', bucket: 'quarter' }, { field: 'severity' }] }),
      { id: 'g1', kind: 'gauge', title: 'Tickets resolved within target', x: 6, y: 14, w: 3, h: 4, config: { spec: { type: 'ticket', filters: all(c('resolved_at', 'nempty'), c('target_missed', 'false')) }, of: all(c('resolved_at', 'nempty')), target: 90, dateField: 'resolved_at' } },
      CHANGE_SUCCESS_GAUGE,
    ],
  },
  {
    key: 'service_desk', name: 'Service desk', refresh_seconds: 300,
    description: 'Live workload, targets and where tickets come from.',
    filters: [...DATE, { kind: 'department', label: 'Department' }, { kind: 'system', label: 'System' }, { kind: 'owner', label: 'Assignee' }],
    widgets: [
      number('n1', 0, 0, 'Open tickets', 'ticket', openTickets, { icon: 'ticket' }),
      number('n2', 3, 0, 'Not yet assigned', 'ticket', all(c('assignee_id', 'empty'), c('resolved_at', 'empty'), c('status', 'nin', ['cancelled', 'closed'])), { icon: 'user', tone: 'bad' }),
      number('n3', 6, 0, 'Open and past target', 'ticket', all(c('target_missed', 'true'), c('resolved_at', 'empty')), { icon: 'clock', tone: 'bad' }),
      { id: 'g1', kind: 'gauge', title: 'Resolved within target', x: 9, y: 0, w: 3, h: 4, config: { spec: { type: 'ticket', filters: all(c('resolved_at', 'nempty'), c('target_missed', 'false')) }, of: all(c('resolved_at', 'nempty')), target: 90, dateField: 'resolved_at' } },
      chart('c1', 0, 2, 5, 4, 'Open tickets by status', 'hbar', { type: 'ticket', filters: openTickets, groupBy: [{ field: 'status' }] }),
      chart('c2', 5, 2, 4, 4, 'Open tickets by priority', 'donut', { type: 'ticket', filters: openTickets, groupBy: [{ field: 'priority' }] }),
      number('n4', 9, 4, 'Resolved in the last 7 days', 'ticket', all(c('resolved_at', 'last_days', 7)), { icon: 'check-circle', tone: 'good' }),
      chart('c3', 0, 6, 7, 4, 'Opened each week, by type', 'stacked', { type: 'ticket', groupBy: [{ field: 'opened_at', bucket: 'week' }, { field: 'type' }], filters: all(c('opened_at', 'last_days', 90)) }, { dateField: 'opened_at' }),
      chart('c4', 7, 6, 5, 4, 'Category against priority', 'heatmap', { type: 'ticket', groupBy: [{ field: 'category' }, { field: 'priority' }] }),
      list('l1', 0, 10, 6, 4, 'Longest-waiting open tickets', { type: 'ticket', columns: ['title', 'priority', 'opened_at'], filters: openTickets, sort: [{ by: 'opened_at', dir: 'asc' }] }),
      chart('c5', 6, 10, 6, 4, 'Open tickets by assignee', 'hbar', { type: 'ticket', filters: openTickets, groupBy: [{ field: 'assignee_id' }] }),
    ],
  },
  {
    key: 'cyber_programme', name: 'Cybersecurity program',
    description: 'Framework progress, risk, vulnerabilities, incidents and the policies behind them.',
    filters: [...DATE, { kind: 'system', label: 'System' }, { kind: 'owner', label: 'Owner' }],
    widgets: [
      { id: 'p1', kind: 'progress', title: 'Priority outcomes largely met or met', x: 0, y: 0, w: 6, h: 2, config: { spec: { type: 'framework_outcome', filters: all(c('priority', 'true'), c('status', 'in', ['largely_met', 'met'])) }, of: all(c('priority', 'true')) } },
      number('n1', 6, 0, 'Open security incidents', 'security_incident', openIncidents, { icon: 'shield', tone: 'bad' }),
      number('n2', 9, 0, 'Overdue vulnerabilities', 'vulnerability', all(c('closed', 'false'), c('overdue', 'true')), { icon: 'bug', tone: 'bad' }),
      chart('c1', 0, 2, 7, 4, 'Outcomes by function and status', 'stacked', { type: 'framework_outcome', groupBy: [{ field: 'function_code' }, { field: 'status' }] }),
      chart('c2', 7, 2, 5, 4, 'Open vulnerabilities by severity', 'bar', { type: 'vulnerability', filters: openVulns, groupBy: [{ field: 'severity' }] }),
      chart('c3', 0, 6, 4, 4, 'Risks by level', 'donut', { type: 'risk', groupBy: [{ field: 'summary_level' }] }),
      chart('c4', 4, 6, 4, 4, 'Risks by treatment', 'hbar', { type: 'risk', groupBy: [{ field: 'treatment' }] }),
      { id: 'k1', kind: 'countdown', title: 'Next notification deadlines', x: 8, y: 6, w: 4, h: 4, config: { spec: { type: 'notification_task', filters: all(c('completed_at', 'empty')) }, dateField: 'due_at' } },
      list('l1', 0, 10, 6, 4, 'Policies due for review', { type: 'policy', columns: ['title', 'owner_id', 'review_date'], filters: all(c('review_date', 'next_days', 90)), sort: [{ by: 'review_date', dir: 'asc' }] }, { dateField: 'review_date' }),
      list('l2', 6, 10, 6, 4, 'Exceptions expiring', { type: 'policy_exception', columns: ['title', 'status', 'expires_on'], filters: all(c('expires_on', 'next_days', 90)), sort: [{ by: 'expires_on', dir: 'asc' }] }, { dateField: 'expires_on' }),
    ],
  },
  {
    key: 'assets_systems', name: 'Assets and systems',
    description: 'What the organization runs, where it is, and what is coming up for renewal.',
    filters: [{ kind: 'site', label: 'Site' }, { kind: 'department', label: 'Department' }, { kind: 'owner', label: 'Owner' }],
    widgets: [
      number('n1', 0, 0, 'Assets', 'asset', undefined, { icon: 'box' }),
      number('n2', 3, 0, 'Systems', 'system', undefined, { icon: 'server' }),
      number('n3', 6, 0, 'Warranties ending in 90 days', 'asset', all(c('warranty_end', 'next_days', 90)), { icon: 'calendar', tone: 'bad' }),
      number('n4', 9, 0, 'Systems without enforced sign-in protection', 'system', all(c('mfa_status', 'in', ['optional', 'none', 'unknown'])), { icon: 'lock', tone: 'bad' }),
      chart('c1', 0, 2, 4, 4, 'Assets by type', 'donut', { type: 'asset', groupBy: [{ field: 'asset_type' }] }),
      chart('c2', 4, 2, 4, 4, 'Assets by status', 'bar', { type: 'asset', groupBy: [{ field: 'status' }] }),
      chart('c3', 8, 2, 4, 4, 'Assets by site', 'hbar', { type: 'asset', groupBy: [{ field: 'site_id' }] }),
      chart('c4', 0, 6, 6, 4, 'Systems: criticality against sign-in protection', 'heatmap', { type: 'system', groupBy: [{ field: 'criticality_tier' }, { field: 'mfa_status' }] }),
      chart('c5', 6, 6, 6, 4, 'Systems by hosting', 'bar', { type: 'system', groupBy: [{ field: 'hosting_type' }] }),
      { id: 'cal', kind: 'calendar', title: 'Warranty end dates', x: 0, y: 10, w: 6, h: 5, config: { spec: { type: 'asset' }, dateField: 'warranty_end' } },
      chart('c6', 6, 10, 6, 5, 'Purchase cost by year', 'area', { type: 'asset', groupBy: [{ field: 'purchase_date', bucket: 'year' }], aggregates: [{ fn: 'sum', field: 'cost' }] }),
    ],
  },
  {
    key: 'vendors', name: 'Vendors and contracts',
    description: 'Who the organization depends on, what the agreements are worth and which dates are close.',
    filters: [...DATE, { kind: 'owner', label: 'Contract owner' }],
    widgets: [
      number('n1', 0, 0, 'Active vendors', 'vendor', all(c('status', 'in', ['active'])), { icon: 'building' }),
      number('n2', 3, 0, 'Active contracts', 'contract', all(c('status', 'in', ['active'])), { icon: 'file-text' }),
      number('n3', 6, 0, 'Notice dates in 120 days', 'contract', all(c('notice_date', 'next_days', 120)), { icon: 'calendar', tone: 'bad', dateField: 'notice_date' }),
      number('n4', 9, 0, 'Evidence expiring in 60 days', 'evidence_item', all(c('expires_on', 'next_days', 60)), { icon: 'clipboard', tone: 'bad', dateField: 'expires_on' }),
      chart('c1', 0, 2, 4, 4, 'Vendors by criticality', 'donut', { type: 'vendor', groupBy: [{ field: 'criticality' }] }),
      chart('c2', 4, 2, 4, 4, 'Contracts by status', 'bar', { type: 'contract', groupBy: [{ field: 'status' }] }),
      { id: 'k1', kind: 'countdown', title: 'Next notice dates', x: 8, y: 2, w: 4, h: 4, config: { spec: { type: 'contract', filters: all(c('status', 'nin', ['terminated', 'expired'])) }, dateField: 'notice_date' } },
      chart('c3', 0, 6, 7, 4, 'Contract value by vendor', 'hbar', { type: 'contract', groupBy: [{ field: 'vendor_id' }], aggregates: [{ fn: 'sum', field: 'total_value' }], sort: [{ by: 'a0', dir: 'desc' }], limit: 10 }),
      chart('c4', 7, 6, 5, 4, 'Contracts ending, by quarter', 'bar', { type: 'contract', filters: all(c('end_date', 'next_days', 730)), groupBy: [{ field: 'end_date', bucket: 'quarter' }] }, { dateField: 'end_date' }),
      chart('c5', 0, 10, 12, 4, 'Contracts by vendor criticality and status', 'stacked', { type: 'contract', groupBy: [{ field: 'vendor_id.criticality' }, { field: 'status' }] }),
    ],
  },
  {
    key: 'portfolio', name: 'Project portfolio',
    description: 'Every project by stage, rating and money.',
    filters: [{ kind: 'department', label: 'Department' }, { kind: 'owner', label: 'Project manager' }],
    widgets: [
      number('n1', 0, 0, 'Projects in flight', 'project', activeProjects, { icon: 'folder' }),
      number('n2', 3, 0, 'Rated red overall', 'project', all(c('rag_overall', 'in', ['red']), c('status', 'in', ['active', 'on_hold'])), { icon: 'alert', tone: 'bad' }),
      { id: 'n3', kind: 'number', title: 'Total budget', x: 6, y: 0, w: 3, h: 2, config: { spec: { type: 'project', filters: activeProjects, aggregates: [{ fn: 'sum', field: 'budget' }] }, format: 'currency', icon: 'scale' } },
      { id: 'p1', kind: 'progress', title: 'Spend against budget', x: 9, y: 0, w: 3, h: 2, config: { spec: { type: 'project', filters: activeProjects, aggregates: [{ fn: 'sum', field: 'spend_to_date' }] }, denominator: { type: 'project', filters: activeProjects, aggregates: [{ fn: 'sum', field: 'budget' }] }, format: 'currency' } },
      chart('c1', 0, 2, 6, 4, 'Projects by stage', 'bar', { type: 'project', filters: activeProjects, groupBy: [{ field: 'stage' }] }),
      chart('c2', 6, 2, 6, 4, 'Stage against overall rating', 'stacked', { type: 'project', filters: activeProjects, groupBy: [{ field: 'stage' }, { field: 'rag_overall' }] }),
      chart('c3', 0, 6, 6, 4, 'Budget by department', 'hbar', { type: 'project', filters: activeProjects, groupBy: [{ field: 'department' }], aggregates: [{ fn: 'sum', field: 'budget' }] }),
      { id: 't1', kind: 'table', title: 'Projects needing attention', x: 6, y: 6, w: 6, h: 4, config: { spec: { type: 'project', columns: ['ref', 'name', 'stage', 'rag_overall', 'rag_trend'], filters: all(c('rag_overall', 'in', ['red', 'amber'])), sort: [{ by: 'rag_overall', dir: 'desc' }] } } },
      { id: 'cal', kind: 'calendar', title: 'Target dates', x: 0, y: 10, w: 6, h: 5, config: { spec: { type: 'project', filters: activeProjects }, dateField: 'target_on' } },
      chart('c4', 6, 10, 6, 5, 'Projects by tier', 'donut', { type: 'project', filters: activeProjects, groupBy: [{ field: 'tier' }] }),
    ],
  },
  {
    key: 'board_summary', name: 'Board summary',
    description: BOARD_SUMMARY_DESCRIPTION,
    filters: [],
    widgets: BOARD_SUMMARY_WIDGETS,
  },
];

export interface StandardReport { key: string; name: string; description: string; spec: ReportSpec; chart: Row }

export const STANDARD_REPORTS: StandardReport[] = [
  { key: 'open_tickets_by_assignee', name: 'Open tickets by assignee and priority', description: 'Who is carrying what, as a pivot table.', spec: { type: 'ticket', filters: openTickets, groupBy: [{ field: 'assignee_id' }, { field: 'priority' }], pivot: true }, chart: { kind: 'table' } },
  { key: 'tickets_per_month', name: 'Tickets opened each month', description: 'Volume over the last year.', spec: { type: 'ticket', filters: all(c('opened_at', 'last_days', 365)), groupBy: [{ field: 'opened_at', bucket: 'month' }] }, chart: { kind: 'line' } },
  { key: 'tickets_missed_target', name: 'Tickets that missed their target', description: 'Every ticket past its response or resolution time, newest first.', spec: { type: 'ticket', columns: ['ref', 'title', 'priority', 'assignee_id', 'opened_at', 'resolved_at', 'breach_reason'], filters: all(c('target_missed', 'true')), sort: [{ by: 'opened_at', dir: 'desc' }] }, chart: { kind: 'table' } },
  { key: 'tickets_by_department', name: 'Tickets by requesting department', description: 'Where demand comes from, with each department\'s share.', spec: { type: 'ticket', groupBy: [{ field: 'requester_department' }], aggregates: [{ fn: 'count' }, { fn: 'pct' }] }, chart: { kind: 'hbar' } },
  { key: 'overdue_actions', name: 'Overdue actions', description: 'Agreed actions past their due date, oldest first.', spec: { type: 'action', columns: ['ref', 'title', 'owner_id', 'priority', 'due_on', 'source'], filters: overdueActions, sort: [{ by: 'due_on', dir: 'asc' }] }, chart: { kind: 'table' } },
  { key: 'assets_by_site_type', name: 'Assets by site and type', description: 'A count of every kind of asset at every site.', spec: { type: 'asset', groupBy: [{ field: 'site_id' }, { field: 'asset_type' }], pivot: true }, chart: { kind: 'table' } },
  { key: 'asset_cost_by_funding', name: 'Asset purchase cost by funding source', description: 'What was spent and from which source.', spec: { type: 'asset', groupBy: [{ field: 'funding_source' }], aggregates: [{ fn: 'sum', field: 'cost' }, { fn: 'count' }] }, chart: { kind: 'donut' } },
  { key: 'systems_by_tier', name: 'Systems by criticality and hosting', description: 'How the most important systems are hosted.', spec: { type: 'system', groupBy: [{ field: 'criticality_tier' }, { field: 'hosting_type' }] }, chart: { kind: 'stacked' } },
  { key: 'contract_renewals', name: 'Contracts with a notice date in the next year', description: 'Agreements to decide on, in date order.', spec: { type: 'contract', columns: ['ref', 'title', 'vendor_id', 'vendor_id.criticality', 'notice_date', 'end_date', 'total_value', 'owner_id'], filters: all(c('notice_date', 'next_days', 365)), sort: [{ by: 'notice_date', dir: 'asc' }] }, chart: { kind: 'table' } },
  { key: 'contract_value_by_vendor', name: 'Contract value by vendor', description: 'Total recorded value of agreements with each vendor.', spec: { type: 'contract', groupBy: [{ field: 'vendor_id' }], aggregates: [{ fn: 'sum', field: 'total_value' }, { fn: 'pct', field: 'total_value' }], sort: [{ by: 'a0', dir: 'desc' }] }, chart: { kind: 'hbar' } },
  { key: 'framework_progress', name: 'Framework outcomes by function and status', description: 'Progress against the cybersecurity framework.', spec: { type: 'framework_outcome', groupBy: [{ field: 'function_code' }, { field: 'status' }], pivot: true }, chart: { kind: 'stacked' } },
  { key: 'top_risks', name: 'High and critical risks', description: 'The risks that most need attention, highest score first.', spec: { type: 'risk', columns: ['ref', 'title', 'category', 'summary_level', 'residual_score', 'treatment', 'owner_id', 'review_on'], filters: all(c('summary_level', 'in', ['high', 'critical'])), sort: [{ by: 'residual_score', dir: 'desc' }] }, chart: { kind: 'table' } },
  { key: 'open_incidents', name: 'Security incidents by severity and status', description: 'Every recorded incident.', spec: { type: 'security_incident', groupBy: [{ field: 'severity' }, { field: 'status' }] }, chart: { kind: 'stacked' } },
  { key: 'vulnerabilities_by_severity', name: 'Open vulnerabilities by severity', description: 'What is still open, with how old the oldest is.', spec: { type: 'vulnerability', filters: openVulns, groupBy: [{ field: 'severity' }], aggregates: [{ fn: 'count' }, { fn: 'max', field: 'age_days' }, { fn: 'avg', field: 'age_days' }] }, chart: { kind: 'bar' } },
  { key: 'project_budget', name: 'Project budget and spend by stage', description: 'Money committed and spent at each stage.', spec: { type: 'project', filters: activeProjects, groupBy: [{ field: 'stage' }], aggregates: [{ fn: 'sum', field: 'budget' }, { fn: 'sum', field: 'spend_to_date' }, { fn: 'count' }] }, chart: { kind: 'bar' } },
  { key: 'changes_by_month', name: 'Changes by month and type', description: 'How much change the organization is making.', spec: { type: 'change', groupBy: [{ field: 'planned_start', bucket: 'month' }, { field: 'change_type' }] }, chart: { kind: 'stacked' } },
  // Fleet and depot equipment.
  { key: 'on_vehicle_past_support', name: 'On-vehicle equipment past its support date', description: 'Onboard computers, fare equipment, validators, routers, cameras, radios and displays still in service after the supplier stops supporting them.', spec: { type: 'asset', columns: ['tag', 'name', 'asset_type', 'site_id', 'make', 'model', 'support_end', 'owner_id'], filters: all(c('asset_type', 'in', ON_VEHICLE), c('support_end', 'past'), c('status', 'nin', ['retired', 'disposed'])), sort: [{ by: 'support_end', dir: 'asc' }] }, chart: { kind: 'table' } },
  { key: 'critical_systems_no_recovery', name: 'Critical systems without recovery targets', description: 'Tier 1 and tier 2 systems with no recovery time or recovery point objective recorded.', spec: { type: 'system', columns: ['ref', 'name', 'criticality_tier', 'hosting_type', 'technical_owner_id', 'rto_hours', 'rpo_hours'], filters: all(c('criticality_tier', 'in', ['tier_1', 'tier_2']), c('status', 'nin', ['retired']), { op: 'or', items: [c('rto_hours', 'empty'), c('rpo_hours', 'empty')] }), sort: [{ by: 'criticality_tier', dir: 'asc' }] }, chart: { kind: 'table' } },
  { key: 'depot_equipment_by_type', name: 'Depot equipment by type and support end year', description: 'Equipment at sites whose name includes "depot", by the year the supplier stops supporting it.', spec: { type: 'asset', filters: all(c('site_id.name', 'contains', 'depot'), c('status', 'nin', ['retired', 'disposed'])), groupBy: [{ field: 'asset_type' }, { field: 'support_end', bucket: 'year' }] }, chart: { kind: 'stacked' } },
];

export const STANDARD_PACK = {
  // The key is kept (an existing installation already has this pack); the wording reads for a
  // board, directors or owners alike (E18-47).
  key: 'governing_body_pack', name: 'Leadership security pack',
  description: 'Framework progress, top risks, open actions and incidents as one dated document.',
  cover_title: 'Technology and security report', cover_subtitle: 'Prepared for the board and senior leadership',
  sections: [
    { kind: 'text', title: 'Summary', body: 'Replace this text with a short summary of the period: what improved, what needs a decision, and what you are asking for.\n\n- One point per line\n- Keep it to what the reader needs to decide' },
    { kind: 'report', reportKey: 'framework_progress' },
    { kind: 'report', reportKey: 'top_risks' },
    { kind: 'figure', figureKey: 'open_risks_by_level', months: 12 },
    { kind: 'report', reportKey: 'overdue_actions' },
    { kind: 'report', reportKey: 'open_incidents' },
  ] as Row[],
};

/**
 * The standard figures recorded over time (E41-04): what a board usually follows month by month.
 * A count of records (with an optional breakdown by a list field) or a metric another module
 * offers. A figure whose part of the application is not loaded or switched off is simply not shown.
 */
export interface StandardFigure { key: string; name: string; description: string; source: 'count' | 'metric'; metric_key?: string; record_type?: string; filters?: FilterGroup; group_field?: string }

export const STANDARD_FIGURES: StandardFigure[] = [
  { key: 'open_risks_by_level', name: 'Open risks by level', description: 'Risks not closed, by their summary level.', source: 'count', record_type: 'risk', filters: all(c('status', 'nin', ['closed'])), group_field: 'summary_level' },
  { key: 'overdue_actions', name: 'Overdue actions', description: 'Open actions past their due date.', source: 'metric', metric_key: 'actions.overdue' },
  { key: 'open_findings_by_rating', name: 'Open audit findings by rating', description: 'Audit and inspection findings not closed, by rating.', source: 'count', record_type: 'audit_finding', filters: all(c('status', 'nin', ['closed'])), group_field: 'rating' },
  { key: 'findings_overdue', name: 'Audit findings overdue', description: 'Findings past their response or close-out date.', source: 'metric', metric_key: 'audits.findings_overdue' },
  { key: 'open_vulnerabilities_by_severity', name: 'Open vulnerabilities by severity', description: 'Vulnerabilities not closed, by severity.', source: 'count', record_type: 'vulnerability', filters: openVulns, group_field: 'severity' },
  { key: 'training_compliance', name: 'Staff qualified for their position', description: 'The share of staff holding every qualification their position needs.', source: 'metric', metric_key: 'training.compliance_pct' },
];
