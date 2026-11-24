// Languages for the app's employee-facing screens (E41-07): the tabs, My work, the policy to
// acknowledge, the tag scan and tag card, the Report tab and the Account tab. A screen keeps its English
// texts where they are (`export const TEXT = localized('<screen>', { ... })`); the translations are in
// ./<code>.ts by the same name. Reading a text gives it in the person's language, falling back to
// English for anything not translated. The choice is a preference on the person's account
// (`language`, GET/PUT /api/me/preferences/language), the same one the self-service portal uses, and is
// kept on the phone so it applies before the server answers.
import { useSyncExternalStore } from 'react';
import { BASE_LANGUAGE, LANGUAGES, pickLanguage } from '../../../shared/i18n.ts';
import es from './es';

export { BASE_LANGUAGE, LANGUAGES, languageName } from '../../../shared/i18n.ts';

/** A screen's texts in one language: the same keys as the English, any of them may be left out. */
export type Translation = Record<string, unknown>;

/** The translation files, by language and screen. */
export const TRANSLATIONS: Record<string, Record<string, Translation>> = { es };

/** Every screen's English texts, by name (filled as the screens load; the missing-keys test reads it). */
export const ENGLISH: Record<string, Record<string, unknown>> = {};

let current = BASE_LANGUAGE;
const listeners = new Set<() => void>();

export const getLanguage = (): string => current;

/** Shows the app in this language from now on (not saved: see setLanguagePreference). */
export function setLanguage(code: string | null | undefined): void {
  const next = pickLanguage(code);
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The language the app is shown in; a component using it is drawn again when it changes. */
export function useLanguage(): string {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function view<T extends Record<string, unknown>>(base: T, translated: () => Record<string, unknown> | undefined): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const english = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') return english;
      if (isPlain(english)) {
        return view(english, () => {
          const t = translated()?.[prop];
          return isPlain(t) ? t : undefined;
        });
      }
      const t = translated()?.[prop];
      return t !== undefined && typeof t === typeof english ? t : english;
    },
  });
}

/**
 * A screen's texts in the language the app is shown in. `name` is the screen's entry in the
 * translation files; `english` its texts (strings, functions that build a string, nested groups).
 */
export function localized<T extends Record<string, unknown>>(name: string, english: T): T {
  ENGLISH[name] = english;
  return view(english, () => (current === BASE_LANGUAGE ? undefined : TRANSLATIONS[current]?.[name]));
}

/**
 * What a translation lacks against the English texts: `screen.key` paths for missing texts, texts of
 * another kind (a string where the English has a function), and keys the English no longer has.
 */
export function missingTranslations(code: string): { missing: string[]; wrongKind: string[]; extra: string[] } {
  const out = { missing: [] as string[], wrongKind: [] as string[], extra: [] as string[] };
  const walk = (path: string, en: Record<string, unknown>, tr: Record<string, unknown> | undefined) => {
    for (const [k, v] of Object.entries(en)) {
      const t = tr?.[k];
      if (isPlain(v)) { if (!isPlain(t)) out.missing.push(`${path}.${k}`); else walk(`${path}.${k}`, v, t); }
      else if (t === undefined) out.missing.push(`${path}.${k}`);
      else if (typeof t !== typeof v) out.wrongKind.push(`${path}.${k}`);
    }
    for (const k of Object.keys(tr ?? {})) if (!(k in en)) out.extra.push(`${path}.${k}`);
  };
  const files = TRANSLATIONS[code] ?? {};
  for (const [name, en] of Object.entries(ENGLISH)) walk(name, en, files[name]);
  for (const name of Object.keys(files)) if (!(name in ENGLISH)) out.extra.push(name);
  return out;
}

/** The languages offered in the Account tab. */
export const languageChoices = () => LANGUAGES.map((l) => ({ code: l.code, name: l.name }));
