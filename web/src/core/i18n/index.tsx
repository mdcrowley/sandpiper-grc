// Languages for the pages staff without a desk use (E41-07): the self-service portal and the policy
// kiosk. The rest of the application is in English. Texts live in translation files
// (./locales/<code>.json, flat keys); `useI18n().t(key, vars)` reads them, falling back to English.
// A person's choice is a preference on their account (`language`, GET/PUT /api/me/preferences),
// so it follows them to other browsers and to the mobile app; the kiosk chooses per session.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ActionIcon, Menu as MMenu } from '@mantine/core';
import { IconWorld } from '@tabler/icons-react';
import { BASE_LANGUAGE, LANGUAGES, pickLanguage, translate, type Messages, type Vars } from '../../../../shared/i18n.ts';
import { formatDate, formatDateTime, relativeTime, timeZone } from '../format';
import { Icon } from '../Icon';
import { useSyncedPreference } from '../preferences';
import './i18n.css';

export { BASE_LANGUAGE, LANGUAGES, languageName, pickLanguage } from '../../../../shared/i18n.ts';

const files = import.meta.glob<{ default: Messages }>('./locales/*.json', { eager: true });
/** Every translation file, by language code. */
export const catalogs: Record<string, Messages> = Object.fromEntries(
  Object.entries(files).map(([path, mod]) => [path.replace(/^.*\/([\w-]+)\.json$/, '$1'), mod.default]),
);

export interface I18n {
  lang: string;
  /** The text for a key, with `{placeholders}` filled; `count` picks the plural form. */
  t: (key: string, vars?: Vars) => string;
  /** "Nov 18, 2026" in English, "18 nov 2026" in Spanish; calendar dates are never shifted. */
  date: (value: string | number | Date | null | undefined) => string;
  dateTime: (value: string | number | Date | null | undefined) => string;
  /** "3 hours ago", "hace 3 horas". */
  ago: (value: string | number | Date | null | undefined) => string;
}

const CALENDAR = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.0+)?(Z|\+00:00))?$/;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000], ['month', 2_592_000_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
];

export function makeI18n(lang: string): I18n {
  const t = (key: string, vars?: Vars) => translate(catalogs, lang, key, vars);
  // English keeps the application's own formats, so the portal reads exactly as it did.
  if (lang === BASE_LANGUAGE) return { lang, t, date: formatDate, dateTime: formatDateTime, ago: (v) => relativeTime(v) };
  const toDate = (v: string | number | Date | null | undefined): Date | null => {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const date = (v: string | number | Date | null | undefined) => {
    if (typeof v === 'string') {
      const m = CALENDAR.exec(v);
      if (m) return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m[1]}T00:00:00Z`));
    }
    const d = toDate(v);
    return d ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: timeZone() }).format(d) : '—';
  };
  const dateTime = (v: string | number | Date | null | undefined) => {
    const d = toDate(v);
    return d ? new Intl.DateTimeFormat(lang, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timeZone(),
    }).format(d) : '—';
  };
  const ago = (v: string | number | Date | null | undefined) => {
    const d = toDate(v);
    if (!d) return '—';
    const diff = d.getTime() - Date.now();
    const fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return fmt.format(Math.round(diff / ms), unit);
    return t('common.justNow');
  };
  return { lang, t, date, dateTime, ago };
}

const I18nContext = createContext<I18n>(makeI18n(BASE_LANGUAGE));

/** Gives the pages below it one language; sets `lang` on the page while it is shown, for screen readers. */
export function I18nProvider({ lang, children, document: setDocument = true }: { lang: string; children: ReactNode; document?: boolean }) {
  const value = useMemo(() => makeI18n(pickLanguage(lang)), [lang]);
  useEffect(() => {
    if (!setDocument) return undefined;
    const before = document.documentElement.lang;
    document.documentElement.lang = value.lang;
    return () => { document.documentElement.lang = before || BASE_LANGUAGE; };
  }, [value.lang, setDocument]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18n => useContext(I18nContext);

/** The browser's language when it is one of ours, else English: the default before a person chooses. */
export const browserLanguage = (): string =>
  pickLanguage(...(typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]));

/**
 * The person's language: their saved choice (a preference on their account, kept in this browser too),
 * else the browser's language when it is one of ours, else English. The setter saves the choice.
 */
export function useLanguageChoice(): [string, (code: string) => void] {
  const [chosen, setChosen] = useSyncedPreference<string | null>('language', 'grc.language', null);
  return [chosen ? pickLanguage(chosen) : browserLanguage(), setChosen];
}

/** A small menu of languages for a page header. */
export function LanguageMenu({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useI18n();
  return (
    <MMenu position="bottom-end" width={200} withinPortal>
      <MMenu.Target>
        <ActionIcon size={44} variant="subtle" color="gray" aria-label={t('common.language.choose', { language: LANGUAGES.find((l) => l.code === value)?.name ?? value })}>
          <IconWorld size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </MMenu.Target>
      <MMenu.Dropdown>
        <MMenu.Label>{t('common.language.label')}</MMenu.Label>
        {LANGUAGES.map((l) => (
          <MMenu.Item key={l.code} lang={l.code} onClick={() => onChange(l.code)} aria-current={l.code === value ? 'true' : undefined}
            leftSection={l.code === value ? <Icon name="check" size={16} /> : <span style={{ width: 16, display: 'inline-block' }} />}>
            {l.name}
          </MMenu.Item>
        ))}
      </MMenu.Dropdown>
    </MMenu>
  );
}

/** Large buttons, one per language, each named in its own language (the kiosk's start screen). */
export function LanguageButtons({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="i18n-languages" role="group" aria-label={t('common.language.label')}>
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" lang={l.code} className={`i18n-language${l.code === value ? ' is-on' : ''}`}
          aria-pressed={l.code === value} onClick={() => onChange(l.code)}>
          {l.name}
        </button>
      ))}
    </div>
  );
}
