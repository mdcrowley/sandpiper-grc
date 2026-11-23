// The side menu sorts each group by `order` (core/module.ts). Two entries with the same number land
// in whichever order the modules load, so related pages drift apart (wave 15: OT security,
// Vulnerabilities, Security zones and the Vulnerability dashboard were interleaved). Every entry
// gives its order, unique within its group, in a group the shell knows.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../modules/*/index.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const moduleSource = (import.meta.glob('./module.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)['./module.ts'];

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
    expect(groups).toContain('People');
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

  it('keeps qualifications and certifications with the people they are about', () => {
    const people = entries.filter((e) => e.group === 'People').map((e) => e.label);
    expect(people).toEqual(expect.arrayContaining(['People', 'Positions', 'Qualifications', 'Certifications']));
  });
});
