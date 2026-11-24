// The person's language choice (E41-07): kept on the phone (so the app opens in it, also offline) and
// on their account on the server (the `language` preference the self-service portal uses too).
import { apiFetch } from '../api/client';
import { storage } from '../auth/storage';
import { pickLanguage } from '../../../shared/i18n.ts';
import { setLanguage } from './index';

/** At start: the phone's copy first, then the account's when the server answers. */
export async function loadLanguage(): Promise<void> {
  try {
    const kept = await storage.language();
    if (kept) setLanguage(kept);
  } catch { /* storage unavailable: English until the server answers */ }
  try {
    const res = await apiFetch<{ value: unknown }>('/api/me/preferences/language');
    if (typeof res.value === 'string' && res.value) {
      const code = pickLanguage(res.value);
      setLanguage(code);
      await storage.setLanguage(code);
    }
  } catch { /* offline or signed out: keep what the phone has */ }
}

/** The person chose a language in the Account tab: shown at once, saved on the phone and the account. */
export async function chooseLanguage(code: string): Promise<void> {
  const next = pickLanguage(code);
  setLanguage(next);
  await storage.setLanguage(next).catch(() => {});
  await apiFetch('/api/me/preferences/language', { method: 'PUT', body: { value: next } });
}
