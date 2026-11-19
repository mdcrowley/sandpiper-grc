import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Shape of a framework reference file shipped with the module (for example csf2.json). */
export interface ReferenceOutcome { code: string; text: string }
export interface ReferenceCategory { code: string; name: string; description?: string; outcomes: ReferenceOutcome[] }
export interface ReferenceFunction {
  code: string; name: string; description?: string; color?: string; categories: ReferenceCategory[];
}
export interface ReferenceFramework {
  key: string; name: string; version?: string; description?: string; functions: ReferenceFunction[];
}

const here = dirname(fileURLToPath(import.meta.url));

/** NIST CSF 2.0 (NIST CSWP 29). Public-domain text. */
export function loadCsf2(): ReferenceFramework {
  return JSON.parse(readFileSync(join(here, 'csf2.json'), 'utf8')) as ReferenceFramework;
}

/** Every outcome in a reference framework with its function and category codes. */
export function flattenReference(ref: ReferenceFramework) {
  return ref.functions.flatMap((f) =>
    f.categories.flatMap((c) =>
      c.outcomes.map((o) => ({ code: o.code, text: o.text, function_code: f.code, category_code: c.code }))));
}
