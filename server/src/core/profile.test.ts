import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOrganizationProfile } from './profile.ts';

let dir = '';
const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'grc-profile-')));
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

describe('organization profile', () => {
  it('reads organization.json', () => {
    fresh();
    writeFileSync(join(dir, 'organization.json'), JSON.stringify({ appName: 'Harbor Line GRC' }));
    const lines: string[] = [];
    expect(readOrganizationProfile(dir, (l) => lines.push(l))).toEqual({ appName: 'Harbor Line GRC' });
    expect(lines).toEqual([]);
  });

  it('falls back to the older organisation.json, with a note', () => {
    fresh();
    writeFileSync(join(dir, 'organisation.json'), JSON.stringify({ appName: 'Older name' }));
    const lines: string[] = [];
    expect(readOrganizationProfile(dir, (l) => lines.push(l))).toEqual({ appName: 'Older name' });
    expect(lines.join('\n')).toMatch(/organisation\.json.*rename it to organization\.json/);
  });

  it('prefers organization.json when both exist, and is empty when neither does', () => {
    fresh();
    expect(readOrganizationProfile(dir, () => {})).toEqual({});
    writeFileSync(join(dir, 'organisation.json'), JSON.stringify({ appName: 'Old' }));
    writeFileSync(join(dir, 'organization.json'), JSON.stringify({ appName: 'New' }));
    expect(readOrganizationProfile(dir, () => {})).toEqual({ appName: 'New' });
  });
});
