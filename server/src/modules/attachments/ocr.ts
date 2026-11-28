// Reading scanned PDFs (E43-15). A PDF whose text layer is empty is read a second time, in the same
// separate reader process as every other file (text.ts, text-reader.mjs, text-worker.mjs), with the
// OCR engine tesseract.js (Apache-2.0; WebAssembly, no outside program) and the language data bundled
// with the application in `tessdata/` (English and Spanish, the languages the application is offered
// in, from the tessdata_fast set, Apache-2.0). Nothing is downloaded while the application runs and
// no outside request is made: the engine is given a local folder and told not to cache anything.
//
// The languages read are chosen under Administration > File settings > Reading scans (E46-56, setting
// `attachments.ocr_languages`, routes in ocr-admin.ts), from the language files in the folder. Until
// a choice is saved, `GRC_OCR_LANGS` (or English) is used.
//
// Settings (environment):
//   GRC_OCR=off            never read scans (they stay "scanned: found by title and number only");
//   GRC_OCR_LANGS=eng+spa  the languages read until a choice is saved in Administration;
//   GRC_OCR_LANG_DIR=dir   a folder of language data to use instead of the bundled one.
// Limits: the first OCR_MAX_PAGES pages, OCR_TIME_LIMIT_MS per file, OCR_MAX_MEMORY_MB for the process.
// When the engine is not installed (the tesseract.js package) or the language data is missing, scans
// are left as they were, with the reason recorded on the file's text status.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleContext } from '../../core/module.ts';

export const OCR_MAX_PAGES = 50;
export const OCR_TIME_LIMIT_MS = 5 * 60_000;
export const OCR_MAX_MEMORY_MB = 1024;
/** At most this many languages are read together (each one adds to the time a page takes). */
export const OCR_MAX_LANGS = 4;
/** The bundled language data. */
export const BUNDLED_LANG_DIR = fileURLToPath(new URL('./tessdata', import.meta.url));
/** The languages chosen in Administration (a list of language-data codes such as ["eng", "spa"]). */
export const SETTING_OCR_LANGS = 'attachments.ocr_languages';

/** Names of the language-data codes of the Tesseract project, for the ones an installation is likely to add. */
const NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', por: 'Portuguese', deu: 'German', ita: 'Italian', nld: 'Dutch',
  pol: 'Polish', rus: 'Russian', ukr: 'Ukrainian', vie: 'Vietnamese', tgl: 'Tagalog', hat: 'Haitian Creole',
  chi_sim: 'Chinese (simplified)', chi_tra: 'Chinese (traditional)', jpn: 'Japanese', kor: 'Korean', ara: 'Arabic',
  fas: 'Persian', hin: 'Hindi', ben: 'Bengali', pan: 'Punjabi', urd: 'Urdu', guj: 'Gujarati', tam: 'Tamil', som: 'Somali',
  amh: 'Amharic', khm: 'Khmer', lao: 'Lao', tha: 'Thai', hmn: 'Hmong', kat: 'Georgian', hye: 'Armenian', ell: 'Greek',
  tur: 'Turkish', heb: 'Hebrew', ron: 'Romanian', hun: 'Hungarian', ces: 'Czech', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish',
};
export const ocrLanguageName = (code: string) => NAMES[code] ?? code;
const CODE = /^[a-z][a-z_]{2,15}$/;

export interface OcrJob { langs: string; langPath: string; gzip: boolean; maxPages: number }
export type OcrState = { ready: true; job: OcrJob } | { ready: false; reason: string };

let engineInstalled: boolean | null = null;
/** Whether the OCR engine package can be found (checked once per process; never loaded here). */
export function ocrEngineInstalled(): boolean {
  if (engineInstalled === null) {
    try {
      createRequire(import.meta.url).resolve('tesseract.js');
      engineInstalled = true;
    } catch {
      engineInstalled = false;
    }
  }
  return engineInstalled;
}

export const ocrSwitchedOff = (env: NodeJS.ProcessEnv = process.env) => /^(off|false|0|no)$/i.test(String(env.GRC_OCR ?? '').trim());
/** The folder of language data in use: GRC_OCR_LANG_DIR, else the bundled one. */
export const ocrLangDir = (env: NodeJS.ProcessEnv = process.env) => String(env.GRC_OCR_LANG_DIR ?? '').trim() || BUNDLED_LANG_DIR;

/** The languages whose data is in the folder in use, by code, in name order (English first). */
export function availableOcrLanguages(env: NodeJS.ProcessEnv = process.env): { code: string; name: string; compressed: boolean }[] {
  let files: string[] = [];
  try { files = readdirSync(ocrLangDir(env)); } catch { return []; }
  const found = new Map<string, boolean>();
  for (const f of files) {
    const m = /^([a-z][a-z_]{2,15})\.traineddata(\.gz)?$/.exec(f);
    if (m && !found.has(m[1])) found.set(m[1], Boolean(m[2]));
  }
  return [...found].map(([code, compressed]) => ({ code, name: ocrLanguageName(code), compressed }))
    .sort((a, b) => (a.code === 'eng' ? -1 : b.code === 'eng' ? 1 : a.name.localeCompare(b.name)));
}

/** A list of language codes from the setting, or null when none is saved (or it is not a list of codes). */
export function chosenOcrLanguages(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes = [...new Set(value.map((v) => String(v)).filter((v) => CODE.test(v)))];
  return codes.length ? codes.slice(0, OCR_MAX_LANGS) : null;
}

/** The languages chosen in Administration, or null when none are saved. */
export async function readOcrLanguages(ctx: ModuleContext): Promise<string[] | null> {
  return chosenOcrLanguages(await ctx.settings.get(SETTING_OCR_LANGS, null));
}

/** The languages read, and where that comes from: the Administration choice, GRC_OCR_LANGS, or English. */
export function ocrLanguages(env: NodeJS.ProcessEnv, chosen: string[] | null): { langs: string; source: 'setting' | 'environment' | 'default' } {
  if (chosen?.length) return { langs: chosen.join('+'), source: 'setting' };
  const fromEnv = String(env.GRC_OCR_LANGS ?? '').trim();
  return fromEnv ? { langs: fromEnv, source: 'environment' } : { langs: 'eng', source: 'default' };
}

/** Whether scans can be read here, and how: with the languages chosen in Administration when given. */
export function ocrState(env: NodeJS.ProcessEnv = process.env, chosen: string[] | null = null): OcrState {
  if (ocrSwitchedOff(env)) return { ready: false, reason: 'reading scans (OCR) is switched off in this installation' };
  if (!ocrEngineInstalled()) return { ready: false, reason: 'the OCR engine (tesseract.js) is not installed' };
  const { langs, source } = ocrLanguages(env, chosen);
  if (!/^[a-z_]{3,16}(\+[a-z_]{3,16})*$/i.test(langs)) return { ready: false, reason: `GRC_OCR_LANGS "${langs}" is not a list of language codes such as eng+spa` };
  const dir = ocrLangDir(env);
  let gzip: boolean | null = null;
  for (const lang of langs.split('+')) {
    const gz = existsSync(join(dir, `${lang}.traineddata.gz`));
    const plain = existsSync(join(dir, `${lang}.traineddata`));
    if (!gz && !plain) {
      return { ready: false, reason: `no language data for "${lang}" in ${source === 'setting' ? 'the language folder (choose the languages again under Administration > File settings)' : dir}` };
    }
    if (gzip !== null && gzip !== gz) return { ready: false, reason: 'the language files must all be compressed (.gz) or all plain' };
    gzip = gz;
  }
  return { ready: true, job: { langs, langPath: dir, gzip: gzip ?? true, maxPages: OCR_MAX_PAGES } };
}

/** For tests: forget whether the engine was found. */
export function resetOcrState(): void { engineInstalled = null; }
