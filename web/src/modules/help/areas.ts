// Guide pages that describe one optional part of the application (Administration > Features).
// While that part is switched off its page is left out of the Help home page and search, and the
// page itself, opened by a link, says so. Keys are page slugs (file names without the number).
// The portal's page follows its switch like every other part (E14-34): Administration > Features says
// what the portal is, and its page comes back once it is switched on.
import { useAuth } from '../../core';

export const PAGE_AREA: Record<string, string> = {
  'service-desk': 'tickets',
  'vendors-and-contracts': 'vendors',
  'cybersecurity-frameworks': 'frameworks',
  'security-incidents': 'secincidents',
  projects: 'projects',
  'change-enablement': 'changes',
  'policies-and-exceptions': 'policies',
  'training-and-exercises': 'training',
  vulnerabilities: 'vulnerabilities',
  'dashboards-and-reports': 'reports',
  'fleet-and-services': 'fleet',
  'safety-management': 'safety',
  'self-service-portal': 'portal',
  // Wave 10 guide pages (25 to 28), named ahead of the pages; an entry with no page does nothing.
  'audits-and-inspections': 'audits',
  'controls-and-testing': 'controls',
  'funding-and-grants': 'funding',
  'committees-and-meetings': 'governance',
  // Wave 11 guide pages (30 to 33). Page 33 covers legal holds too, which stay on: the records work
  // keeps the hold part of that page readable (or moves it) when the records area is off.
  'business-continuity': 'continuity',
  'asset-condition': 'condition',
  'ot-security': 'ot',
  'records-requests-and-privacy': 'records',
  'vendor-risk-lifecycle': 'vendors',
  // Wave 13 guide pages (38 and 39), named ahead of the pages.
  'asset-tags': 'tags',
  'mobile-app': 'mobile',
  // Wave 20 (E41-02).
  'user-access-reviews': 'accessreviews',
  // Wave 22 (E41-15).
  'records-retention-schedule': 'recordsretention',
};

/** Whether a guide page's part of the application is on (pages of no particular part always are). */
export function usePageOn(): (slug: string) => boolean {
  const { areaOn } = useAuth();
  return (slug) => !PAGE_AREA[slug] || areaOn(PAGE_AREA[slug]);
}
