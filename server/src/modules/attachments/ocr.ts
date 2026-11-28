// Reading scanned PDFs (E43-15). A PDF whose text layer is empty is read a second time, in the same
// separate reader process as every other file (text.ts, text-reader.mjs, text-worker.mjs), with the
// OCR engine tesseract.js (Apache-2.0; WebAssembly, no outside program) and the language data bundled
// with the application in `tessdata/` (English, from the tessdata_fast set, Apache-2.0). Nothing is
// downloaded while the application runs and no outside request is made: the engine is given a local
// folder and told not to cache anything.
//
// Settings (environment):
//   GRC_OCR=off            never read scans (they stay "scanned: found by title and number only");
//   GRC_OCR_LANGS=eng+spa  the languages to read (each needs <lang>.traineddata[.gz] in the folder);
//   GRC_OCR_LANG_DIR=dir   a folder of language data to use instead of the bundled one.
// Limits: the first OCR_MAX_PAGES pages, OCR_TIME_LIMIT_MS per file, OCR_MAX_MEMORY_MB for the process.
// When the engine is not installed (the tesseract.js package) or the language data is missing, scans
// are left as they were, with the reason recorded on the file's text status.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OCR_MAX_PAGES = 50;
export const OCR_TIME_LIMIT_MS = 5 * 60_000;
export const OCR_MAX_MEMORY_MB = 1024;
/** The bundled language data. */
export const BUNDLED_LANG_DIR = fileURLToPath(new URL('./tessdata', import.meta.url));

export interface OcrJob { langs: string; langPath: string; gzip: boolean; maxPages: number }
export type OcrState = { ready: true; job: OcrJob } | { ready: false; reason: string };

let engineInstalled: boolean | null = null;
/** Whether the OCR engine package can be found (checked once per process; never loaded here). */
function installed(): boolean {
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

/** Whether scans can be read here, and how. */
export function ocrState(env: NodeJS.ProcessEnv = process.env): OcrState {
  if (/^(off|false|0|no)$/i.test(String(env.GRC_OCR ?? '').trim())) return { ready: false, reason: 'reading scans (OCR) is switched off in this installation' };
  if (!installed()) return { ready: false, reason: 'the OCR engine (tesseract.js) is not installed' };
  const langs = String(env.GRC_OCR_LANGS ?? 'eng').trim() || 'eng';
  if (!/^[a-z_]{3,16}(\+[a-z_]{3,16})*$/i.test(langs)) return { ready: false, reason: `GRC_OCR_LANGS "${langs}" is not a list of language codes such as eng+spa` };
  const dir = String(env.GRC_OCR_LANG_DIR ?? '').trim() || BUNDLED_LANG_DIR;
  let gzip: boolean | null = null;
  for (const lang of langs.split('+')) {
    const gz = existsSync(join(dir, `${lang}.traineddata.gz`));
    const plain = existsSync(join(dir, `${lang}.traineddata`));
    if (!gz && !plain) return { ready: false, reason: `no language data for "${lang}" in ${dir}` };
    const mine = gz;
    if (gzip !== null && gzip !== mine) return { ready: false, reason: 'the language files must all be compressed (.gz) or all plain' };
    gzip = mine;
  }
  return { ready: true, job: { langs, langPath: dir, gzip: gzip ?? true, maxPages: OCR_MAX_PAGES } };
}

/** For tests: forget whether the engine was found. */
export function resetOcrState(): void { engineInstalled = null; }
