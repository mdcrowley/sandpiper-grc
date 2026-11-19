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
  { prefix: '/problems', page: '02-service-desk', section: 'problems-and-known-errors' },
  { prefix: '/knowledge', page: '02-service-desk', section: 'knowledge-base' },
  { prefix: '/catalog', page: '02-service-desk', section: 'catalog' },

  // Inventory
  { prefix: '/systems', exact: true, page: '03-inventory', section: 'systems' },
  { prefix: '/systems', page: '03-inventory', section: 'the-system-record-a-fact-sheet' },
  { prefix: '/systems/map', page: '03-inventory', section: 'the-relationship-map' },
  { prefix: '/assets', page: '03-inventory', section: 'assets' },
  { prefix: '/assets/import', page: '03-inventory', section: 'importing-assets-from-csv' },
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
  { prefix: '/contracts', exact: true, page: '04-vendors-and-contracts', section: 'contracts' },
  { prefix: '/contracts', page: '04-vendors-and-contracts', section: 'the-contract-record' },
  { prefix: '/contracts/renewals', page: '04-vendors-and-contracts', section: 'the-renewal-calendar-and-reminders' },
  { prefix: '/evidence', page: '04-vendors-and-contracts', section: 'evidence-and-expiry' },
  { prefix: '/evidence/expiring', page: '04-vendors-and-contracts', section: 'expiry' },

  // Cybersecurity
  { prefix: '/frameworks', page: '05-cybersecurity-frameworks', section: 'the-outcomes-board' },
  { prefix: '/frameworks/settings', page: '05-cybersecurity-frameworks', section: 'framework-settings' },
  { prefix: '/frameworks/outcomes', exact: true, page: '05-cybersecurity-frameworks', section: 'table-view' },
  { prefix: '/frameworks/outcomes', page: '05-cybersecurity-frameworks', section: 'working-on-one-outcome' },
  { prefix: '/assessments', page: '05-cybersecurity-frameworks', section: 'assessments' },
  { prefix: '/risks', exact: true, page: '06-risks-actions-obligations', section: 'the-risk-register' },
  { prefix: '/risks', page: '06-risks-actions-obligations', section: 'scoring-a-risk' },
  { prefix: '/actions', exact: true, page: '06-risks-actions-obligations', section: 'the-action-tracker' },
  { prefix: '/actions', page: '06-risks-actions-obligations', section: 'what-an-action-holds' },
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
  { prefix: '/report-packs', page: '15-dashboards-and-reports', section: 'report-packs' },
  { prefix: '/reports/schedules', page: '15-dashboards-and-reports', section: 'scheduled-delivery' },
  { prefix: '/reports/snapshots', page: '15-dashboards-and-reports', section: 'scheduled-delivery' },
  { prefix: '/dashboards', exact: true, page: '15-dashboards-and-reports', section: 'dashboards' },
  { prefix: '/dashboards', page: '15-dashboards-and-reports', section: 'looking-at-a-dashboard' },

  // Administration
  { prefix: '/admin', page: '09-administration' },
  { prefix: '/admin/users', exact: true, page: '09-administration', section: 'users' },
  { prefix: '/admin/users', page: '09-administration', section: 'changing-a-persons-details-and-roles' },
  { prefix: '/admin/roles', page: '09-administration', section: 'roles-and-permissions' },
  { prefix: '/admin/reminders', page: '14-attachments-and-notifications', section: 'reminders' },
  { prefix: '/admin/lists', page: '09-administration', section: 'lists' },
  { prefix: '/admin/settings', page: '09-administration', section: 'settings' },
  { prefix: '/admin/audit', page: '09-administration', section: 'the-audit-log' },
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
