// Every widget the Overview can show, in its default order. To add one: write the component in
// one of the widgets*.tsx files, give it a definition there, and it appears here, in the
// Customize dialog and (at its default position) in every saved layout.
import type { WidgetCtx, WidgetDef, WidgetGroup } from './types';
import { MY_WORK_WIDGETS } from './widgetsMyWork';
import { NEWER_WIDGETS } from './widgetsNewer';
import { OPERATIONS_WIDGETS } from './widgetsOperations';
import { SUMMARY_WIDGETS } from './widgetsSummary';
import { VULN_AGE_WIDGETS } from './widgetsVulnAge';
import { IT_LEADERSHIP_WIDGETS } from './widgetsItLeadership';
import { AREA_LEAD_WIDGETS } from './widgetsAreaLeads';
// Wave 26 (E46): panels the new areas ship in their own folders; each is shown only with that area's view permission.
import { PROCUREMENT_WIDGETS } from '../procurement/HomeWidget';
import { STRATEGY_WIDGETS } from '../strategy/HomeWidget';
import { CIVIL_RIGHTS_WIDGETS } from '../civilrights/widgets';

/** Charts, figures and tables about the organization as a whole need this as well as their own area's permission. */
export const DASHBOARD_PERMISSION = 'dashboards.view';

// Wave 26: an active emergency first, then safety and operations (the leaders of those areas see their work).
const DASHBOARD_ORDER = [
  'active-emergency', 'attention', 'headline', 'safety-glance', 'inspections-due', 'fleet-status', 'condition-glance', 'continuity-glance', 'incident-clocks', 'tickets-priority', 'changes-week', 'change-success', 'service-levels', 'vulnerabilities-severity', 'vulnerabilities-age',
  'top-risks', 'framework-progress', 'training-completion', 'policies-status', 'contract-notice', 'projects-status', 'strategy-status', 'procurement', 'civil-rights',
];

const dashboard = [...SUMMARY_WIDGETS, ...OPERATIONS_WIDGETS, ...NEWER_WIDGETS, ...VULN_AGE_WIDGETS, ...IT_LEADERSHIP_WIDGETS, ...AREA_LEAD_WIDGETS,
  ...PROCUREMENT_WIDGETS, ...STRATEGY_WIDGETS, ...CIVIL_RIGHTS_WIDGETS];
const position = (id: string) => {
  const at = DASHBOARD_ORDER.indexOf(id);
  return at < 0 ? DASHBOARD_ORDER.length : at;
};

export const WIDGETS: WidgetDef[] = [
  ...MY_WORK_WIDGETS,
  ...[...dashboard].sort((a, b) => position(a.id) - position(b.id)),
];

export const DEFAULT_ORDER: string[] = WIDGETS.map((w) => w.id);

export const GROUP_LABELS: Record<WidgetGroup, string> = { mywork: 'My work', dashboard: 'Dashboard' };

/** The widgets this person can have, in default order. A widget left out here never renders, so it never sends a request. */
export function availableWidgets(ctx: WidgetCtx): WidgetDef[] {
  const dashboards = ctx.can(DASHBOARD_PERMISSION);
  return WIDGETS.filter((w) => (w.group === 'mywork' || dashboards) && w.visible(ctx));
}
