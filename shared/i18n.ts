// Languages (E41-07): the languages the portal, the policy kiosk and the app's employee-facing
// screens can be shown in, and the small helpers the web application, the app and the server
// share. The texts themselves are in translation files: web/src/core/i18n/locales/<code>.json and
// mobile/src/i18n/<code>.ts. Adding a language: add it here and add its files; the missing-keys
// tests (and `npx tsx tools/i18n-missing.ts`) list what is left to translate.

export interface Language {
  /** A BCP 47 language tag (the language only): `en`, `es`. */
  code: string;
  /** The language's name in that language, as the person choosing it reads it. */
  name: string;
  /** Its name in English, for the people who keep the translations. */
  english: string;
}

/** The language every text is written in first. A policy's own text is in this language. */
export const BASE_LANGUAGE = 'en';

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'es', name: 'Español', english: 'Spanish' },
];

export const isLanguage = (v: unknown): v is string => typeof v === 'string' && LANGUAGES.some((l) => l.code === v);

/** The language's own name ("Español"), or the code when it is not one of LANGUAGES. */
export const languageName = (code: string): string => LANGUAGES.find((l) => l.code === code)?.name ?? code;
/** The language's name in English ("Spanish"), for staff screens, exports and audit summaries. */
export const englishName = (code: string): string => LANGUAGES.find((l) => l.code === code)?.english ?? code;

/**
 * The first of the candidates that is one of LANGUAGES, matched on the language part, so `es-MX` and
 * `ES` give `es`; BASE_LANGUAGE when none is.
 */
export function pickLanguage(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const code = c.trim().toLowerCase().split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return BASE_LANGUAGE;
}

/** A flat translation file: `{ "portal.home.hello": "Hello, {name}" }`. */
export type Messages = Record<string, string>;
export type Vars = Record<string, string | number | null | undefined>;

/** Fills `{name}` placeholders; a placeholder with no value is left as it is, so it shows up in testing. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === null || v === undefined ? whole : String(v);
  });
}

const rulesCache = new Map<string, Intl.PluralRules>();
function pluralCategory(lang: string, count: number): string {
  let rules = rulesCache.get(lang);
  if (!rules) {
    try { rules = new Intl.PluralRules(lang); } catch { rules = new Intl.PluralRules(BASE_LANGUAGE); }
    rulesCache.set(lang, rules);
  }
  return rules.select(count);
}

/**
 * The text for `key` in `lang`, falling back to the base language, then to the key itself. With a
 * numeric `count` in `vars`, `key_one`, `key_other` (and the language's other plural forms) are
 * tried first, chosen by the language's plural rules.
 */
export function translate(catalogs: Record<string, Messages>, lang: string, key: string, vars?: Vars): string {
  const own = catalogs[lang] ?? {};
  const base = catalogs[BASE_LANGUAGE] ?? {};
  const count = vars?.count;
  if (typeof count === 'number') {
    const form = `${key}_${pluralCategory(lang, count)}`;
    const other = `${key}_other`;
    const text = own[form] ?? own[other] ?? base[`${key}_${pluralCategory(BASE_LANGUAGE, count)}`] ?? base[other];
    if (text !== undefined) return fill(text, vars);
  }
  return fill(own[key] ?? base[key] ?? key, vars);
}

/** The placeholders a text uses, sorted: `{name}` and `{count}` give ['count', 'name']. */
export const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

export interface CatalogProblems {
  /** Keys of the base file with no translation. */
  missing: string[];
  /** Keys the translation has that the base file does not (left over after a text was removed). */
  extra: string[];
  /** Keys whose translation uses other placeholders than the base text. */
  placeholders: string[];
  /** Keys whose translation is empty. */
  empty: string[];
}

/**
 * What a translation file lacks against the base file. A plural key counts as translated when the
 * translation has its `_other` form (languages differ in which forms they need).
 */
export function catalogProblems(base: Messages, other: Messages): CatalogProblems {
  const stem = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '');
  const pluralStems = new Set(Object.keys(base).filter((k) => /_(one|other)$/.test(k)).map(stem));
  const has = (k: string) => k in other || (pluralStems.has(stem(k)) && `${stem(k)}_other` in other);
  const missing = Object.keys(base).filter((k) => !has(k)).sort();
  const extra = Object.keys(other).filter((k) => !(k in base) && !(pluralStems.has(stem(k)) && `${stem(k)}_other` in base)).sort();
  // A plural form may leave the number out ("One document"), so {count} is not compared there.
  const used = (k: string, text: string) => placeholders(text).filter((p) => !(p === 'count' && pluralStems.has(stem(k)))).join();
  const mismatched = Object.keys(base).filter((k) => k in other && used(k, base[k]) !== used(k, other[k])).sort();
  const empty = Object.keys(other).filter((k) => !String(other[k]).trim()).sort();
  return { missing, extra, placeholders: mismatched, empty };
}
