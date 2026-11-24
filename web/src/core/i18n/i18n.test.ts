// Translation files (E41-07): every language is complete, and every key the portal and the kiosk use
// is in the English file, so no page ever shows a raw key. `npx tsx tools/i18n-missing.ts` lists the
// same problems for a translator.
import { describe, expect, it } from 'vitest';
import { catalogProblems, LANGUAGES, pickLanguage, translate } from '../../../../shared/i18n.ts';
import { catalogs, makeI18n } from './index';

const SOURCES = Object.values({
  ...import.meta.glob('../../modules/portal/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../modules/policies/Kiosk.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./index.tsx', { query: '?raw', import: 'default', eager: true }),
}) as string[];

describe('translation files', () => {
  it('has a file for every language', () => {
    expect(Object.keys(catalogs).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const lang of LANGUAGES.filter((l) => l.code !== 'en')) {
    it(`${lang.english} is complete`, () => {
      expect(catalogProblems(catalogs.en, catalogs[lang.code])).toEqual({ missing: [], extra: [], placeholders: [], empty: [] });
    });
  }

  it('has every key the portal and the kiosk use', () => {
    const used = new Set<string>();
    for (const source of SOURCES) {
      for (const m of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    const has = (k: string) => k in catalogs.en || `${k}_other` in catalogs.en;
    expect([...used].filter((k) => !has(k))).toEqual([]);
    // Keys built at run time.
    for (const k of ['portal.requests.tab.open', 'portal.approvals.requestRef', 'portal.approvals.reject_change', 'portal.rate.word5', 'portal.banner.outage']) {
      expect(has(k)).toBe(true);
    }
  });
});

describe('translate', () => {
  it('fills placeholders, picks plural forms and falls back to English', () => {
    expect(translate(catalogs, 'es', 'kiosk.hello', { name: 'Ana' })).toBe('Hola, Ana');
    expect(translate(catalogs, 'es', 'kiosk.thanks', { name: 'Ana', count: 1 })).toBe('Gracias, Ana. Se confirmó 1 documento.');
    expect(translate(catalogs, 'en', 'kiosk.thanks', { name: 'Ana', count: 2 })).toBe('Thank you, Ana. 2 documents acknowledged.');
    expect(translate({ en: { a: 'A' }, es: {} }, 'es', 'a')).toBe('A');
    expect(translate(catalogs, 'es', 'no.such.key')).toBe('no.such.key');
  });

  it('chooses a language from browser tags', () => {
    expect(pickLanguage('es-MX')).toBe('es');
    expect(pickLanguage('fr-FR', 'ES')).toBe('es');
    expect(pickLanguage('de')).toBe('en');
    expect(pickLanguage(null)).toBe('en');
  });

  it('writes dates in the language, keeping English as the application writes them', () => {
    expect(makeI18n('en').date('2026-11-18')).toBe('Nov 18, 2026');
    expect(makeI18n('es').date('2026-11-18')).toMatch(/18 nov/);
  });
});
