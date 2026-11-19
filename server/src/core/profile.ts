import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The organization profile's file name in the seed folder. */
export const PROFILE_FILE = 'organization.json';
/** The earlier, British-spelled name; still read when the new file is absent. */
export const LEGACY_PROFILE_FILE = 'organisation.json';

/**
 * Reads the organization profile from `<seedDir>/organization.json`, falling back to the older
 * `organisation.json` (with a note through `log`) when only that exists. `{}` when neither does.
 */
export function readOrganizationProfile(seedDir: string, log: (line: string) => void = console.log): Record<string, any> {
  const current = join(seedDir, PROFILE_FILE);
  if (existsSync(current)) return JSON.parse(readFileSync(current, 'utf8'));
  const legacy = join(seedDir, LEGACY_PROFILE_FILE);
  if (existsSync(legacy)) {
    log(`seed: reading ${LEGACY_PROFILE_FILE}; rename it to ${PROFILE_FILE} (the old name is still read for now)`);
    return JSON.parse(readFileSync(legacy, 'utf8'));
  }
  return {};
}
