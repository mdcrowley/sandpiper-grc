import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The organization profile's file name in the seed folder. */
export const PROFILE_FILE = 'organization.json';
/** The earlier, British-spelled name; still read when the new file is absent. */
export const LEGACY_PROFILE_FILE = 'organisation.json';

/**
 * The organization profile (`seed/organization.json`): an optional, one-time import. Its details
 * are written into the organization settings (Administration > Organization) only where none are
 * stored yet, so the application, not the file, is where they live (core/organization.ts). Every
 * part is optional. An invented example is in `examples/organization.example.json`.
 */
export interface OrganizationProfile {
  /** The application name (setting `app.name`). */
  appName?: string;
  /** Display name, legal name and short name or abbreviation. */
  name?: string;
  legalName?: string;
  shortName?: string;
  /** Postal address; `street` is up to three lines (an array, or text with line breaks). */
  address?: { street?: string | string[]; city?: string; region?: string; postalCode?: string; country?: string };
  phone?: string;
  email?: string;
  website?: string;
  /** Who to call about a security incident (printed in the incident kit). */
  securityContact?: { phone?: string; email?: string };
  /** Colors as #rrggbb; logo files (PNG, JPEG or WebP) named relative to the seed folder. */
  branding?: { primaryColor?: string; accentColor?: string; logo?: string; logoDark?: string };
  /** Extra values for configurable lists, by list key. */
  lookups?: Record<string, unknown[]>;
  /** Read by modules from `opts.organization` (for example `obligations`, `notificationRules`). */
  [section: string]: unknown;
}

/** The `dev` seed profile's organization: invented, so screens and documents show a full example. */
export const DEV_ORGANIZATION: OrganizationProfile = {
  name: 'Example Transit Authority',
  legalName: 'Example Transit Authority (example data)',
  shortName: 'ETA',
  address: { street: ['100 Depot Street', 'Suite 200'], city: 'Example City', region: 'Example Region', postalCode: '00000', country: 'Example Country' },
  phone: '+1 555 0100',
  email: 'info@example.org',
  website: 'https://www.example.org',
  securityContact: { phone: '+1 555 0199', email: 'security@example.org' },
};

/**
 * Reads the organization profile from `<seedDir>/organization.json`, falling back to the older
 * `organisation.json` (with a note through `log`) when only that exists. `{}` when neither does.
 */
export function readOrganizationProfile(seedDir: string, log: (line: string) => void = console.log): OrganizationProfile {
  const current = join(seedDir, PROFILE_FILE);
  if (existsSync(current)) return JSON.parse(readFileSync(current, 'utf8'));
  const legacy = join(seedDir, LEGACY_PROFILE_FILE);
  if (existsSync(legacy)) {
    log(`seed: reading ${LEGACY_PROFILE_FILE}; rename it to ${PROFILE_FILE} (the old name is still read for now)`);
    return JSON.parse(readFileSync(legacy, 'utf8'));
  }
  return {};
}
