// "Help for this page": which guide page (and section) explains each screen.
// The shell links to /help?for=<current pathname>; the Help home page looks the pathname up
// here and goes straight to the section. The longest matching prefix wins; a prefix matches
// the address itself and anything below it ("/tickets" matches "/tickets/123", not
// "/ticketing"). `exact` limits an entry to the address itself, so a list and its record
// pages can point at different sections. `page` is the file name in docs/user without ".md".
// When a route or a guide heading changes, change this list too.

export interface RouteHelp { prefix: string; page: string; section?: string; exact?: boolean }

export const ROUTE_HELP: RouteHelp[] = [
  // Home, account and sign-in
  { prefix: '/', exact: true, page: '01-getting-started', section: 'overview' },
  { prefix: '/account/security', page: '09-administration', section: 'my-account-the-account-security-page' },
  { prefix: '/sign-in/recovery', page: '01-getting-started', section: 'recovery-codes' },
  { prefix: '/redeem', page: '09-administration', section: 'one-time-setup-and-reset-links' },
  { prefix: '/notifications', page: '14-attachments-and-notifications', section: 'the-notifications-page' },
  { prefix: '/attachments', page: '14-attachments-and-notifications', section: 'attachments' },
  { prefix: '/attachments/expiring', page: '14-attachments-and-notifications', section: 'expiring-evidence-files' },

  // Service desk
  { prefix: '/tickets', page: '02-service-desk', section: 'tickets' },
  { prefix: '/tickets/dashboard', page: '02-service-desk', section: 'service-desk-dashboard' },
  { prefix: '/tickets/settings', page: '02-service-desk', section: 'service-desk-settings' },
  { prefix: '/problems', page: '02-service-desk', section: 'problems-and-known-errors' },
  { prefix: '/knowledge', page: '02-service-desk', section: 'knowledge-base' },
  { prefix: '/catalog', page: '02-service-desk', section: 'catalog' },

  // Inventory
  { prefix: '/systems', exact: true, page: '03-inventory', section: 'systems' },
  { prefix: '/systems', page: '03-inventory', section: 'the-system-record-a-fact-sheet' },
  { prefix: '/systems/map', page: '03-inventory', section: 'the-relationship-map' },
  { prefix: '/assets', page: '03-inventory', section: 'assets' },
  { prefix: '/assets/import', page: '03-inventory', section: 'importing-assets-from-csv' },
  { prefix: '/assets/disposals', page: '03-inventory', section: 'dispose-of-an-asset' },
  { prefix: '/sites', page: '03-inventory', section: 'sites' },
  { prefix: '/data-categories', page: '03-inventory', section: 'data-categories' },
  { prefix: '/inventory', page: '03-inventory' },
  { prefix: '/inventory/reports', page: '03-inventory', section: 'inventory-reports' },

  // Change
  { prefix: '/changes', exact: true, page: '10-change-enablement', section: 'the-register' },
  { prefix: '/changes', page: '10-change-enablement', section: 'the-life-of-a-change' },
  { prefix: '/changes/calendar', page: '10-change-enablement', section: 'the-change-calendar' },
  { prefix: '/changes/new', page: '10-change-enablement', section: 'raising-a-change' },
  { prefix: '/changes/settings', page: '10-change-enablement', section: 'change-settings' },

  // Vendors
  { prefix: '/vendors', exact: true, page: '04-vendors-and-contracts', section: 'vendors' },
  { prefix: '/vendors', page: '04-vendors-and-contracts', section: 'the-vendor-profile' },
  { prefix: '/vendors/terms', page: '04-vendors-and-contracts', section: 'the-security-terms-matrix' },
  { prefix: '/vendors/questions', page: '04-vendors-and-contracts', section: 'the-questions' },
  { prefix: '/vendors/intake', page: '34-vendor-risk-lifecycle', section: 'intake-and-risk-tiers' },
  { prefix: '/vendors/reassessments', page: '34-vendor-risk-lifecycle', section: 'reassessments-due' },
  { prefix: '/vendors/issues', page: '34-vendor-risk-lifecycle', section: 'vendor-issues' },
  { prefix: '/vendors/offboardings', page: '34-vendor-risk-lifecycle', section: 'offboarding' },
  { prefix: '/contracts', exact: true, page: '04-vendors-and-contracts', section: 'contracts' },
  { prefix: '/contracts', page: '04-vendors-and-contracts', section: 'the-contract-record' },
  { prefix: '/contracts/renewals', page: '04-vendors-and-contracts', section: 'the-renewal-calendar-and-reminders' },
  { prefix: '/contracts/dates', page: '04-vendors-and-contracts', section: 'complete-the-dates' },
  { prefix: '/contracts/performance', page: '04-vendors-and-contracts', section: 'contractor-performance' },
  { prefix: '/evidence', page: '04-vendors-and-contracts', section: 'evidence-and-expiry' },
  { prefix: '/evidence/expiring', page: '04-vendors-and-contracts', section: 'expiry' },

  // Cybersecurity
  { prefix: '/frameworks', page: '05-cybersecurity-frameworks', section: 'the-outcomes-board' },
  { prefix: '/frameworks/settings', page: '05-cybersecurity-frameworks', section: 'framework-settings' },
  { prefix: '/frameworks/coverage', page: '05-cybersecurity-frameworks', section: 'coverage-of-other-frameworks' },
  { prefix: '/frameworks/manage', page: '05-cybersecurity-frameworks', section: 'frameworks-and-structure' },
  { prefix: '/frameworks/outcomes', exact: true, page: '05-cybersecurity-frameworks', section: 'table-view' },
  { prefix: '/frameworks/outcomes', page: '05-cybersecurity-frameworks', section: 'working-on-one-outcome' },
  { prefix: '/assessments', page: '05-cybersecurity-frameworks', section: 'assessments' },
  { prefix: '/risks', exact: true, page: '06-risks-actions-obligations', section: 'the-risk-register' },
  { prefix: '/risks', page: '06-risks-actions-obligations', section: 'scoring-a-risk' },
  { prefix: '/risks/reviews', page: '06-risks-actions-obligations', section: 'risk-reviews' },
  { prefix: '/risks/report', page: '06-risks-actions-obligations', section: 'the-risk-report' },
  { prefix: '/risks/scales', page: '06-risks-actions-obligations', section: 'editing-the-risk-scales' },
  { prefix: '/actions', exact: true, page: '06-risks-actions-obligations', section: 'the-action-tracker' },
  { prefix: '/actions', page: '06-risks-actions-obligations', section: 'what-an-action-holds' },
  { prefix: '/actions/mine', page: '06-risks-actions-obligations', section: 'my-actions' },
  { prefix: '/obligations', page: '06-risks-actions-obligations', section: 'the-obligations-register' },
  { prefix: '/security-incidents', exact: true, page: '07-security-incidents' },
  { prefix: '/security-incidents', page: '07-security-incidents', section: 'the-incident-workspace' },
  { prefix: '/security-incidents/declare', page: '07-security-incidents', section: 'declaring-an-incident' },
  { prefix: '/security-incidents/notifications', page: '07-security-incidents', section: 'notification-clocks' },
  { prefix: '/security-incidents/rules', page: '07-security-incidents', section: 'notification-rules-checklists-and-contacts' },
  { prefix: '/security-incidents/kit', page: '07-security-incidents', section: 'the-offline-incident-kit' },
  { prefix: '/vulnerabilities', exact: true, page: '13-vulnerabilities', section: 'the-findings-list' },
  { prefix: '/vulnerabilities', page: '13-vulnerabilities', section: 'the-finding-page' },
  { prefix: '/vulnerabilities/dashboard', page: '13-vulnerabilities', section: 'the-dashboard' },
  { prefix: '/vulnerabilities/import', page: '13-vulnerabilities', section: 'import-findings' },
  { prefix: '/vulnerabilities/imports', page: '13-vulnerabilities', section: 'import-history' },
  { prefix: '/vulnerabilities/duplicates', page: '13-vulnerabilities', section: 'duplicate-findings' },
  { prefix: '/vulnerabilities/settings', page: '13-vulnerabilities', section: 'the-severity-policy' },
  { prefix: '/policies', exact: true, page: '11-policies-and-exceptions', section: 'the-policy-library' },
  { prefix: '/policies', page: '11-policies-and-exceptions', section: 'the-policy-page' },
  { prefix: '/policies/acknowledgments', page: '11-policies-and-exceptions', section: 'track-acknowledgment' },
  { prefix: '/exceptions', page: '11-policies-and-exceptions', section: 'exceptions' },
  { prefix: '/training', page: '12-training-and-exercises', section: 'training-overview' },
  { prefix: '/training/courses', page: '12-training-and-exercises', section: 'courses' },
  { prefix: '/training/records', page: '12-training-and-exercises', section: 'record-completions' },
  { prefix: '/training/import', page: '12-training-and-exercises', section: 'import-completions' },
  { prefix: '/training/mine', page: '12-training-and-exercises', section: 'my-training' },
  { prefix: '/exercises', page: '12-training-and-exercises', section: 'exercises' },
  { prefix: '/exercises/calendar', page: '12-training-and-exercises', section: 'exercise-calendar' },

  // Projects
  { prefix: '/projects', exact: true, page: '08-projects', section: 'the-portfolio' },
  { prefix: '/projects', page: '08-projects', section: 'the-project-page' },
  { prefix: '/projects/new', page: '08-projects', section: 'submitting-a-request-intake' },
  { prefix: '/projects/settings', page: '08-projects', section: 'project-settings' },

  // Reports and dashboards
  { prefix: '/reports', page: '15-dashboards-and-reports', section: 'reports' },
  { prefix: '/reports/new', page: '15-dashboards-and-reports', section: 'build-a-report' },
  { prefix: '/reports/packs', page: '15-dashboards-and-reports', section: 'report-packs' },
  { prefix: '/reports/figures', page: '15-dashboards-and-reports', section: 'figures-over-time' },
  { prefix: '/reports/schedules', page: '15-dashboards-and-reports', section: 'scheduled-delivery' },
  { prefix: '/reports/snapshots', page: '15-dashboards-and-reports', section: 'scheduled-delivery' },
  { prefix: '/dashboards', exact: true, page: '15-dashboards-and-reports', section: 'dashboards' },
  { prefix: '/dashboards', page: '15-dashboards-and-reports', section: 'looking-at-a-dashboard' },

  // Administration
  { prefix: '/admin', page: '09-administration' },
  { prefix: '/admin/users', exact: true, page: '09-administration', section: 'users' },
  { prefix: '/admin/users', page: '09-administration', section: 'changing-a-persons-details-and-roles' },
  { prefix: '/admin/roles', page: '09-administration', section: 'roles-and-permissions' },
  { prefix: '/admin/workflows', page: '22-approval-workflows', section: 'setting-up-workflows-administrators' },
  { prefix: '/approvals', page: '22-approval-workflows', section: 'approvals-waiting-for-you' },
  { prefix: '/admin/reminders', page: '14-attachments-and-notifications', section: 'reminders' },
  { prefix: '/admin/lists', page: '09-administration', section: 'lists' },
  { prefix: '/admin/organization', page: '09-administration', section: 'organization' },
  { prefix: '/admin/features', page: '09-administration', section: 'features' },
  { prefix: '/admin/lifecycles', page: '23-lifecycles', section: 'setting-up-a-lifecycle-administrators' },
  { prefix: '/admin/settings', page: '09-administration', section: 'settings' },
  { prefix: '/admin/audit', page: '09-administration', section: 'the-audit-log' },
  { prefix: '/admin/about', page: '09-administration', section: 'about-and-updates' },
  { prefix: '/admin/tokens', page: '09-administration', section: 'api-tokens' },
  { prefix: '/admin/webhooks', page: '09-administration', section: 'webhooks' },
  { prefix: '/admin/custom-fields', page: '09-administration', section: 'custom-fields' },
  { prefix: '/admin/retention', page: '09-administration', section: 'retention' },
  { prefix: '/admin/attachments', page: '14-attachments-and-notifications', section: 'file-settings' },
  { prefix: '/admin/backups', page: '14-attachments-and-notifications', section: 'backups' },
  { prefix: '/admin/email', page: '14-attachments-and-notifications', section: 'email-settings' },
  { prefix: '/admin/jobs', page: '14-attachments-and-notifications', section: 'background-jobs' },
  { prefix: '/admin/sign-in-providers', page: '09-administration', section: 'sign-in-providers-single-sign-on' },
  { prefix: '/admin/ai-assistants', page: '21-ai-assistants-and-mcp', section: 'switching-it-on-administrators' },

  // Account
  { prefix: '/account/passkeys', page: '16-passkeys-and-security-keys', section: 'add-a-passkey-or-security-key' },
  { prefix: '/account/ai-assistant', page: '21-ai-assistants-and-mcp', section: 'connecting-your-assistant' },
  { prefix: '/forgot-password', page: '14-attachments-and-notifications', section: 'forgot-your-password' },
  { prefix: '/oauth/authorize', page: '21-ai-assistants-and-mcp', section: 'connecting-a-remote-connector-by-signing-in' },
  { prefix: '/sign-in/passkey', page: '16-passkeys-and-security-keys', section: 'sign-in-with-a-passkey' },

  // Self-service portal
  { prefix: '/portal', page: '18-self-service-portal' },

  // Fleet and services
  { prefix: '/vehicles', page: '19-fleet-and-services', section: 'vehicles' },
  { prefix: '/fleet/coverage', page: '19-fleet-and-services', section: 'equipment-coverage' },
  { prefix: '/fleet/impact', page: '19-fleet-and-services', section: 'what-is-affected' },
  { prefix: '/services', page: '19-fleet-and-services', section: 'services' },

  // Safety
  { prefix: '/safety', page: '20-safety-management', section: 'safety-dashboard' },
  { prefix: '/safety/events', page: '20-safety-management', section: 'safety-events' },
  { prefix: '/safety/hazards', page: '20-safety-management', section: 'hazard-log' },
  { prefix: '/safety/indicators', page: '20-safety-management', section: 'safety-performance-indicators' },
  { prefix: '/safety/exposure', page: '20-safety-management', section: 'exposure' },
  { prefix: '/safety/reporting-rules', page: '20-safety-management', section: 'safety-reporting-rules' },
  { prefix: '/safety/confidential', page: '20-safety-management', section: 'confidential-reporting' },
  { prefix: '/safety/matrix', page: '20-safety-management', section: 'change-the-hazard-matrix' },

  // Corrective action plans
  { prefix: '/caps', exact: true, page: '24-corrective-action-plans', section: 'the-register' },
  { prefix: '/caps', page: '24-corrective-action-plans', section: 'the-plan-page' },

  // Audits and inspections
  { prefix: '/audits', page: '25-audits-and-inspections', section: 'plan-and-coverage' },
  { prefix: '/audits/areas', page: '25-audits-and-inspections', section: 'the-audit-universe' },
  { prefix: '/audits/engagements', page: '25-audits-and-inspections', section: 'audits' },
  { prefix: '/audits/templates', page: '25-audits-and-inspections', section: 'checklists' },
  { prefix: '/audits/requests', page: '25-audits-and-inspections', section: 'evidence-requests' },
  { prefix: '/audits/my-requests', page: '25-audits-and-inspections', section: 'evidence-requests' },
  { prefix: '/inspections', page: '25-audits-and-inspections', section: 'inspections' },
  { prefix: '/inspections/schedules', page: '25-audits-and-inspections', section: 'schedules' },
  { prefix: '/audit-findings', page: '25-audits-and-inspections', section: 'findings' },
  { prefix: '/admin/outside-reviewers', page: '25-audits-and-inspections', section: 'outside-reviewers' },

  // Controls
  { prefix: '/controls', exact: true, page: '26-controls-and-testing', section: 'the-control-library' },
  { prefix: '/controls', page: '26-controls-and-testing', section: 'what-a-control-covers' },
  { prefix: '/controls/dashboard', page: '26-controls-and-testing', section: 'the-controls-dashboard' },
  { prefix: '/controls/coverage', page: '26-controls-and-testing', section: 'the-coverage-view' },
  { prefix: '/controls/tests', exact: true, page: '26-controls-and-testing', section: 'testing-a-control' },
  { prefix: '/controls/tests', page: '26-controls-and-testing', section: 'finish-and-sign-off' },

  // Funding and grants
  { prefix: '/funding', exact: true, page: '27-funding-and-grants', section: 'funding-dashboard' },
  { prefix: '/funding/awards', page: '27-funding-and-grants', section: 'funding-awards' },
  { prefix: '/funding/certifications', page: '27-funding-and-grants', section: 'yearly-certifications' },
  { prefix: '/funding/reviews', page: '27-funding-and-grants', section: 'compliance-reviews' },
  { prefix: '/funding/deficiencies', page: '27-funding-and-grants', section: 'deficiencies-and-corrective-action-plans' },
  { prefix: '/funding/review-areas', page: '27-funding-and-grants', section: 'review-areas-from-a-file' },
  { prefix: '/funding/subrecipients', page: '27-funding-and-grants', section: 'sub-recipients' },

  // Committees and meetings
  { prefix: '/governance/committees', page: '28-committees-and-meetings', section: 'committees' },
  { prefix: '/governance/meetings', page: '28-committees-and-meetings', section: 'meetings' },
  { prefix: '/governance/decisions', page: '28-committees-and-meetings', section: 'decisions-register' },

  // People and qualifications
  { prefix: '/people', page: '29-people-and-qualifications', section: 'the-roster' },
  { prefix: '/people/positions', page: '29-people-and-qualifications', section: 'positions' },
  { prefix: '/people/departments', page: '29-people-and-qualifications', section: 'departments' },
  { prefix: '/training/qualifications', page: '29-people-and-qualifications', section: 'the-qualification-matrix' },
  { prefix: '/training/certifications', page: '12-training-and-exercises', section: 'qualifications-and-certifications' },
  { prefix: '/policies/kiosk', page: '11-policies-and-exceptions', section: 'the-acknowledgment-kiosk' },

  // Obligations, regulatory change and enterprise risk
  { prefix: '/regulatory-changes', page: '06-risks-actions-obligations', section: 'regulatory-changes' },
  { prefix: '/kris', page: '06-risks-actions-obligations', section: 'key-risk-indicators' },
  { prefix: '/risks/appetite', page: '06-risks-actions-obligations', section: 'risk-appetite' },

  // Business continuity
  { prefix: '/continuity', page: '30-business-continuity', section: 'overview' },
  { prefix: '/continuity/processes', page: '30-business-continuity', section: 'business-processes' },
  { prefix: '/continuity/impact-analyses', page: '30-business-continuity', section: 'impact-analysis' },
  { prefix: '/continuity/gaps', page: '30-business-continuity', section: 'gap-report' },
  { prefix: '/continuity/plans', page: '30-business-continuity', section: 'plans' },
  { prefix: '/continuity/activations', page: '30-business-continuity', section: 'emergency-activations' },

  // Asset condition
  { prefix: '/condition', exact: true, page: '31-asset-condition', section: 'the-dashboard' },
  { prefix: '/condition/classes', page: '31-asset-condition', section: 'asset-classes' },
  { prefix: '/condition/assessments', page: '31-asset-condition', section: 'condition-assessments' },
  { prefix: '/condition/aging', page: '31-asset-condition', section: 'the-aging-list' },

  // OT security
  { prefix: '/ot', page: '32-ot-security', section: 'the-ot-overview' },
  { prefix: '/ot/zones', page: '32-ot-security', section: 'security-zones' },
  { prefix: '/ot/conduits', page: '32-ot-security', section: 'conduits' },
  { prefix: '/access-reviews', page: '40-user-access-reviews', section: 'review-campaigns' },
  { prefix: '/access-reviews/accounts', page: '40-user-access-reviews', section: 'accounts-on-systems' },
  { prefix: '/access-reviews/mine', page: '40-user-access-reviews', section: 'reviewing-the-accounts-of-a-system' },
  // Registers an administrator defines (E41-06).
  { prefix: '/registers', exact: true, page: '41-registers', section: 'opening-a-register' },
  { prefix: '/registers', page: '41-registers', section: 'working-with-records' },
  { prefix: '/admin/registers', page: '41-registers', section: 'defining-a-register-administrators' },

  // Legal holds, records requests and privacy
  { prefix: '/admin/legal-holds', page: '33-legal-holds' },
  { prefix: '/admin/legal-holds', exact: true, page: '33-legal-holds', section: 'place-a-hold' },
  { prefix: '/records-requests', exact: true, page: '37-records-requests-and-privacy', section: 'requests' },
  { prefix: '/records-requests', page: '37-records-requests-and-privacy', section: 'clock' },
  { prefix: '/privacy', exact: true, page: '37-records-requests-and-privacy', section: 'privacy-coverage' },
  { prefix: '/privacy/assessments', page: '37-records-requests-and-privacy', section: 'privacy-impact-assessments' },
  // Records retention schedule and destruction log (E41-15).
  { prefix: '/retention-schedule', exact: true, page: '42-records-retention-schedule', section: 'record-series' },
  { prefix: '/retention-schedule', page: '42-records-retention-schedule', section: 'record-series' },
  { prefix: '/destruction-log', exact: true, page: '42-records-retention-schedule', section: 'proposing-a-destruction' },
  { prefix: '/destruction-log', page: '42-records-retention-schedule', section: 'approval' },

  // Integrations
  { prefix: '/admin/provisioning', page: '35-user-provisioning-and-log-forwarding', section: 'user-provisioning' },
  { prefix: '/admin/log-forwarding', page: '35-user-provisioning-and-log-forwarding', section: 'log-forwarding' },
  { prefix: '/account/calendar-feeds', page: '36-calendar-feeds-work-trackers-and-evidence-links', section: 'calendar-feeds' },
  { prefix: '/calendar', page: '36-calendar-feeds-work-trackers-and-evidence-links', section: 'compliance-calendar' },
  { prefix: '/admin/calendar-and-work-trackers', page: '36-calendar-feeds-work-trackers-and-evidence-links' },

  // Asset tags
  { prefix: '/inventory-counts', exact: true, page: '38-asset-tags', section: 'inventory-counts' },
  { prefix: '/inventory-counts/report', page: '38-asset-tags', section: 'the-count-report' },
  { prefix: '/inventory-counts', page: '38-asset-tags', section: 'counting' },
  { prefix: '/admin/asset-tags', exact: true, page: '38-asset-tags', section: 'tag-formats' },
  { prefix: '/admin/asset-tags/stock', page: '38-asset-tags', section: 'tag-stock' },
  { prefix: '/admin/asset-tags/series', page: '38-asset-tags', section: 'printing-your-own-tags' },
  { prefix: '/admin/asset-tags/print', page: '38-asset-tags', section: 'printing-your-own-tags' },
  { prefix: '/admin/asset-tags/settings', page: '38-asset-tags', section: 'settings' },
  { prefix: '/asset-tags/find', page: '38-asset-tags', section: 'finding-a-tag-on-the-web' },

  // Mobile app
  { prefix: '/account/devices', page: '39-mobile-app', section: 'devices-and-lost-phones' },
  { prefix: '/admin/mobile-app', page: '39-mobile-app', section: 'for-administrators' },
  { prefix: '/admin/push', page: '39-mobile-app', section: 'push-notifications' },
];

/** The guide entry for an address, or undefined when nothing covers it. */
export function helpFor(pathname: string): RouteHelp | undefined {
  const path = (pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/');
  let best: RouteHelp | undefined;
  for (const entry of ROUTE_HELP) {
    const exact = path === entry.prefix;
    const below = !entry.exact && (entry.prefix === '/' || path.startsWith(`${entry.prefix}/`));
    if (!exact && !below) continue;
    // Longest prefix wins; at the same length an entry for the address itself wins.
    if (!best || entry.prefix.length > best.prefix.length || (entry.prefix.length === best.prefix.length && entry.exact && !best.exact)) best = entry;
  }
  return best;
}
