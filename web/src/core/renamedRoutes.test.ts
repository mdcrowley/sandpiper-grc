import { describe, expect, it } from 'vitest';
import { ROUTE_HELP } from '../modules/help/routeMap';
import { RENAMED_ROUTES, renamedPath } from './renamedRoutes';

// Every module source file, to check the new addresses exist and nothing links to the old ones.
const SOURCES = import.meta.glob<string>(['../modules/**/*.{ts,tsx}', '!../modules/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });
const moduleSources = Object.values(SOURCES).join('\n');

describe('renamed addresses', () => {
  it('sends old addresses to the new ones, keeping the rest of the address', () => {
    expect(renamedPath('/catalogue')).toBe('/catalog');
    expect(renamedPath('/catalogue/42', '?tab=history', '#top')).toBe('/catalog/42?tab=history#top');
    expect(renamedPath('/portal/catalogue/7')).toBe('/portal/catalog/7');
    expect(renamedPath('/policies/acknowledgements')).toBe('/policies/acknowledgments');
    expect(renamedPath('/policies/acknowledgements/abc')).toBe('/policies/acknowledgments/abc');
  });

  it('leaves everything else alone', () => {
    for (const p of ['/catalog', '/catalog/42', '/catalogues', '/portal/catalog', '/policies', '/policies/acknowledgments', '/tickets']) {
      expect([p, renamedPath(p)]).toEqual([p, null]);
    }
  });

  it('points at addresses that exist, and nothing links to the old ones', () => {
    for (const r of RENAMED_ROUTES) {
      expect([r.to, moduleSources.includes(`'${r.to}'`) || moduleSources.includes(`"${r.to}"`)]).toEqual([r.to, true]);
      expect([r.from, ROUTE_HELP.some((h) => h.prefix === r.from)]).toEqual([r.from, false]);
      expect([r.from, new RegExp(`['"\`]${r.from}(['"\`/?])`).test(moduleSources)]).toEqual([r.from, false]);
    }
  });
});
