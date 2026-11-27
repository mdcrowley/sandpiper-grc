// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { DocVersion } from './types';

// The module registry is built by the web build; these tests need none of it.
vi.mock('../../../core/module', () => ({ modules: [], moduleOn: () => true, NAV_GROUPS: [] }));
const { accessBody, EMPTY_ACCESS, readersPhrase } = await import('./AccessEditor');
const { markWords } = await import('./Library');
const { versionDates, versionName } = await import('./parts');
const { exampleNumber } = await import('./Settings');
const { docNumber } = await import('./types');
const { placeImages } = await import('./VersionUpload');

const v = (over: Partial<DocVersion>): DocVersion => ({
  id: 'v', policy_id: 'p', version: 2, status: 'published', change_summary: null, approved_by_name: null, approved_on: null,
  effective_on: null, published_at: null, created_at: '2026-01-01T00:00:00Z', author_name: null, ...over,
});

describe('document library search marks (E43-12)', () => {
  it('marks every searched word, ignoring case, as text', () => {
    expect(markWords('Reset the router, then the Router logs', 'router logs')).toEqual([
      { text: 'Reset the ', hit: false }, { text: 'router', hit: true }, { text: ', then the ', hit: false },
      { text: 'Router', hit: true }, { text: ' ', hit: false }, { text: 'logs', hit: true },
    ]);
  });
  it('treats pattern characters in the query as nothing special', () => {
    expect(markWords('a (bc) c', '(bc)* [')).toEqual([{ text: 'a (', hit: false }, { text: 'bc', hit: true }, { text: ') c', hit: false }]);
    expect(markWords('text', '')).toEqual([{ text: 'text', hit: false }]);
  });
});

describe('version dates (E43-04)', () => {
  it('says when each version was in force', () => {
    expect(versionDates(v({ effective_on: '2026-03-01' }))).toMatch(/^Effective from /);
    expect(versionDates(v({ status: 'superseded', effective_on: '2024-01-10', superseded_on: '2026-02-28' }))).toMatch(/^In force .+ to .+/);
    expect(versionDates(v({ status: 'withdrawn', effective_on: '2024-01-10', withdrawn_on: '2026-02-28' }))).toMatch(/then withdrawn$/);
    expect(versionDates(v({ status: 'approved', scheduled: true, effective_on: '2027-01-01' }))).toMatch(/^Approved, effective on /);
    expect(versionDates(v({ status: 'draft' }))).toBe('Draft');
  });
  it('shows the revision label the organization knows', () => {
    expect(versionName(v({ version_label: 'Rev. C' }))).toBe('Rev. C (version 2)');
    expect(versionName(v({}))).toBe('Version 2');
  });
});

describe('access editor (E43-03)', () => {
  it('sends no names for an organization-wide document', () => {
    expect(accessBody({ access: 'organization', access_departments: ['d'], access_roles: ['r'], access_groups: [], access_users: ['u'] })).toEqual(EMPTY_ACCESS);
    const restricted = { ...EMPTY_ACCESS, access: 'restricted' as const, access_users: ['u'] };
    expect(accessBody(restricted)).toBe(restricted);
  });
  it('counts readers in words', () => {
    expect(readersPhrase(1)).toBe('1 person can read it.');
    expect(readersPhrase(12)).toBe('12 people can read it.');
  });
});

describe('numbers and conversion', () => {
  it('shows an example of the numbering pattern', () => {
    expect(exampleNumber('{prefix}-{dept}-{seq:3}')).toBe('SOP-IT-014');
    expect(exampleNumber('{prefix}{seq}')).toBe('SOP14');
  });
  it('uses the number, or the reference while there is none', () => {
    expect(docNumber({ doc_number: 'SOP-IT-014', ref: 'POL-00001' })).toBe('SOP-IT-014');
    expect(docNumber({ doc_number: null, ref: 'POL-00001' })).toBe('POL-00001');
  });
  it('puts the stored pictures in place of the preview markers', () => {
    expect(placeImages('![a](attachment:pending-1) ![b](attachment:pending-2) ![c](attachment:pending-3)', ['x', 'y']))
      .toBe('![a](attachment:x) ![b](attachment:y) ![c](attachment:pending-3)');
  });
});
