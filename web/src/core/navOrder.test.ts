// The side menu sorts each group by `order` (core/module.ts). Two entries with the same number land
// in whichever order the modules load, so related pages drift apart (wave 15: OT security,
// Vulnerabilities, Security zones and the Vulnerability dashboard were interleaved). Every entry
// gives its order, unique within its group, in a group the shell knows.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../modules/*/index.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const moduleSource = (import.meta.glob('./navGroups.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['./navGroups.ts'];

interface Entry { module: string; group: string; label: string; order?: number }

/** The navigation entries of every module: object literals with a `group` (Create entries have none). */
const entries: Entry[] = Object.entries(sources).flatMap(([path, text]) => {
  const module = path.split('/')[2];
  return [...text.matchAll(/\{[^{}]*\bgroup:\s*'([^']+)'[^{}]*\}/g)].map((m) => {
    const label = m[0].match(/\blabel:\s*'([^']*)'/)?.[1] ?? '';
    const order = m[0].match(/\border:\s*(\d+(?:\.\d+)?)/)?.[1];
    return { module, group: m[1], label, order: order === undefined ? undefined : Number(order) };
  });
});

const groups = JSON.parse(`[${moduleSource.match(/export const NAV_GROUPS = \[([^\]]*)\]/)![1].replace(/'/g, '"').replace(/,\s*$/, '')}]`) as string[];

describe('side menu order', () => {
  it('finds the entries', () => {
    expect(entries.length).toBeGreaterThan(80);
    expect(groups).toContain('People and training');
  });

  it('puts every entry in a known group, with an order of its own', () => {
    for (const e of entries) {
      expect(groups, `${e.module}: ${e.label}`).toContain(e.group);
      expect(e.order, `${e.module}: ${e.label} has no order`).toBeTypeOf('number');
    }
  });

  it('gives no two entries of a group the same order', () => {
    const ties: string[] = [];
    for (const group of groups) {
      const seen = new Map<number, Entry>();
      for (const e of entries.filter((x) => x.group === group)) {
        const other = seen.get(e.order!);
        if (other) ties.push(`${group} ${e.order}: ${other.label} (${other.module}) and ${e.label} (${e.module})`);
        else seen.set(e.order!, e);
      }
    }
    expect(ties).toEqual([]);
  });

  // E44-01 (wave 24): pages that are tabs or Administration cards are not menu entries, so the menu stays short.
  it('keeps the side menu short and points every page at an entry that exists', () => {
    const literals = Object.values(sources).flatMap((text) => [...text.matchAll(/\{[^{}]*\bgroup:\s*'[^']+'[^{}]*\}/g)].map((m) => m[0]));
    const paths = new Set(literals.map((l) => l.match(/\bpath:\s*'([^']*)'/)?.[1]));
    const inMenu = literals.filter((l) => !/\bmenu:\s*false\b/.test(l));
    expect(inMenu.length, inMenu.map((l) => l.match(/\blabel:\s*'([^']*)'/)?.[1]).join(', ')).toBeLessThanOrEqual(60);
    for (const l of literals) {
      const parent = l.match(/\bparent:\s*'([^']*)'/)?.[1];
      if (parent) expect(paths, `${l} names a parent that is no entry`).toContain(parent);
      if (/\btab:\s*'/.test(l)) expect(parent, `${l} is a tab without a parent`).toBeTruthy();
      const hub = l.match(/\bhub:\s*'([^']*)'/)?.[1];
      if (hub) expect(['People and access', 'Organization', 'Records setup', 'Area settings', 'Connections', 'Data and operations']).toContain(hub);
    }
  });

  it('keeps qualifications and certifications with the people they are about', () => {
    const people = entries.filter((e) => e.group === 'People and training').map((e) => e.label);
    expect(people).toEqual(expect.arrayContaining(['People', 'Positions', 'Qualifications', 'Certifications']));
  });
});
