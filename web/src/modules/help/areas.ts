// Guide pages that describe one optional part of the application (Administration > Features).
// While that part is switched off its page is left out of the Help home page and search, and the
// page itself, opened by a link, says so. Keys are page slugs (file names without the number).
// The portal page stays: the portal starts switched off, and its page explains how to set it up.
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
};

/** Whether a guide page's part of the application is on (pages of no particular part always are). */
export function usePageOn(): (slug: string) => boolean {
  const { areaOn } = useAuth();
  return (slug) => !PAGE_AREA[slug] || areaOn(PAGE_AREA[slug]);
}
