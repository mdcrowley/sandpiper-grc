// Guard for E22-48: a table that can scroll sideways sits in `TableWrap`, which makes its scroll
// box a named Tab stop while the table is wider than the box (axe: scrollable-region-focusable).
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(sources).map(([path, text]) => ({ path: path.replace(/^\.\.\//, '').replace(/^\.\//, 'core/'), text }));

/**
 * Files with a `<table>` that need no TableWrap, and why. Anything else holding a table must use
 * TableWrap (or say here how its scroll box stays reachable).
 */
const NO_WRAP: Record<string, string> = {
  'core/Chart.tsx': 'the data table is for screen readers only and never shows',
  'core/ListTable.tsx': 'the record list: rows are a Tab stop and move with the arrow keys',
  'modules/frameworks/SnapshotReport.tsx': 'a printable sheet whose tables wrap to the page width',
  'modules/secincidents/KitPage.tsx': 'a printable sheet whose tables wrap to the page width',
  'modules/secincidents/ReportPage.tsx': 'a printable sheet whose tables wrap to the page width',
  'modules/help/HelpPage.tsx': 'guide tables are wrapped in a focusable, named box when the page is rendered',
  'modules/vendors/TermsMatrix.tsx': 'its scroll box is a focusable, named region of its own',
  'modules/vendors/ValueByYear.tsx': 'three narrow columns that wrap; the table does not scroll',
};

describe('tables that scroll sideways (E22-48)', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('uses TableWrap instead of a hand-written table-wrap box', () => {
    const offenders = files.filter(({ path, text }) => path !== 'core/ui.tsx'
      && (/className=\{?\s*["'`](?:[^"'`]*\s)?table-wrap(?=[\s"'`$])/.test(text) || /cx\(\s*["']table-wrap["']/.test(text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('does not use Mantine scroll containers around tables', () => {
    const offenders = files.filter(({ text }) => /Table\.ScrollContainer/.test(text) || /<ScrollArea[^>]*>\s*<(?:table|Table)\b/.test(text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('wraps every table in TableWrap unless the file is listed with a reason', () => {
    const offenders = files.filter(({ path, text }) => /<table\b/.test(text) && !/<TableWrap\b/.test(text) && !NO_WRAP[path]).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the list of exceptions current', () => {
    const stale = Object.keys(NO_WRAP).filter((path) => {
      const file = files.find((f) => f.path === path);
      return !file || !/<table\b|<Table\b/.test(file.text);
    });
    expect(stale).toEqual([]);
  });
});
