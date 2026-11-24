// Lists what each translation file lacks (E41-07): `npx tsx tools/i18n-missing.ts`.
// Web: web/src/core/i18n/locales/<code>.json against en.json. App: mobile/src/i18n/<code>.ts against the
// English texts of the screens (its own Jest test, `mobile/src/i18n/i18n.test.ts`, checks the same).
// Exits with 1 when a language of shared/i18n.ts LANGUAGES is incomplete.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogProblems, LANGUAGES, type Messages } from '../shared/i18n.ts';

const dir = join(import.meta.dirname, '..', 'web', 'src', 'core', 'i18n', 'locales');
const read = (code: string): Messages => JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8')) as Messages;
const base = read('en');
let failed = false;
for (const lang of LANGUAGES.filter((l) => l.code !== 'en')) {
  const file = join(dir, `${lang.code}.json`);
  if (!existsSync(file)) { console.log(`${lang.english} (${lang.code}): no file ${file}`); failed = true; continue; }
  const p = catalogProblems(base, read(lang.code));
  const total = p.missing.length + p.extra.length + p.placeholders.length + p.empty.length;
  console.log(`${lang.english} (${lang.code}): ${total ? `${total} problem${total === 1 ? '' : 's'}` : 'complete'} (${Object.keys(base).length} texts)`);
  for (const [what, keys] of Object.entries(p)) for (const k of keys as string[]) console.log(`  ${what}: ${k}${what === 'missing' ? ` = ${JSON.stringify(base[k])}` : ''}`);
  if (total) failed = true;
}
console.log('The app\'s texts: cd mobile; npx jest src/i18n');
process.exit(failed ? 1 : 0);
