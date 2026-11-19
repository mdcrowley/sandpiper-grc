import { describe, expect, it } from 'vitest';
import { helpFor, ROUTE_HELP } from './routeMap';
import { parseGuide, search, searchWords, splitMarks, type SearchEntry } from './text';

// The guide pages, read the same way the Help module bundles them.
const DOCS = import.meta.glob<string>('../../../../docs/user/*.md', { query: '?raw', import: 'default', eager: true });
const doc = (page: string) => DOCS[`../../../../docs/user/${page}.md`];

describe('Help for this page', () => {
  it('points every entry at a guide page and a heading that exist', () => {
    const missing: string[] = [];
    for (const entry of ROUTE_HELP) {
      const file = doc(entry.page);
      if (file === undefined) { missing.push(`${entry.prefix}: no ${entry.page}.md`); continue; }
      if (!entry.section) continue;
      const ids = parseGuide(file).headings.map((h) => h.id);
      if (!ids.includes(entry.section)) missing.push(`${entry.prefix}: no #${entry.section} in ${entry.page}.md`);
    }
    expect(missing).toEqual([]);
  });

  it('takes the longest matching prefix, and keeps exact entries to their own address', () => {
    expect(helpFor('/')?.section).toBe('overview');
    expect(helpFor('/systems')?.section).toBe('systems');
    expect(helpFor('/systems/1234')?.section).toBe('the-system-record-a-fact-sheet');
    expect(helpFor('/systems/map')?.section).toBe('the-relationship-map');
    expect(helpFor('/admin/users/')?.section).toBe('users');
    expect(helpFor('/admin/users/42?tab=history')?.section).toBe('changing-a-persons-details-and-roles');
    expect(helpFor('/ticketing')).toBeUndefined();
  });
});

describe('Help search', () => {
  const entries: SearchEntry[] = [
    { page: 'a', pageTitle: 'Administration', id: 'second-factor', title: 'Second factor', text: 'Scan the QR code with an authenticator app. Recovery codes work once.' },
    { page: 'b', pageTitle: 'Risks', id: 'heat-map', title: 'Heat map', text: 'The heat map shows likelihood against impact.' },
  ];

  it('finds sections by any word and returns a snippet around the match', () => {
    const hits = search(entries, 'recovery codes');
    expect(hits[0].id).toBe('second-factor');
    expect(hits[0].snippet.toLowerCase()).toContain('recovery codes');
    expect(search(entries, 'nothing-like-this')).toEqual([]);
  });

  it('marks the matched words for highlighting, whatever their case', () => {
    const pieces = splitMarks('The Heat map shows', searchWords('heat'));
    expect(pieces.filter((p) => p.hit).map((p) => p.text)).toEqual(['Heat']);
    expect(pieces.map((p) => p.text).join('')).toBe('The Heat map shows');
  });
});
