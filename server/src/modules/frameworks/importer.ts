// Loading a framework from a reference file (the shape of csf2.json, see reference.ts and
// docs/user/05-cybersecurity-frameworks.md). Loading the same key again updates names and
// wording and adds what is new; it never changes a status, an owner or anything else people
// have recorded, and it never removes an outcome.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { ReferenceFramework } from './reference.ts';
import { flattenReference } from './reference.ts';
import { COLOURS, saveStructure } from './structure.ts';

const KEY = /^[a-z0-9][a-z0-9._-]{1,59}$/i;
const MAX_ERRORS = 40;
const MAX_OUTCOMES = 5000;

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const optional = (v: unknown) => text(v) || undefined;

/** Checks a parsed reference file. Returns a cleaned copy, or the list of problems in plain words. */
export function validateReference(input: unknown): { ref?: ReferenceFramework; errors: string[] } {
  const errors: string[] = [];
  const say = (m: string) => { if (errors.length < MAX_ERRORS) errors.push(m); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['The file must hold one JSON object describing a framework.'] };
  const src = input as Row;
  const key = text(src.key);
  if (!key) say('"key" is missing: give the framework a short unique key, for example "example-standard-1".');
  else if (!KEY.test(key)) say('"key" may hold only letters, digits, dots, hyphens and underscores (2 to 60 characters).');
  if (!text(src.name)) say('"name" is missing.');
  if ('outcomes' in src) say('Outcomes are listed at the top of the file. Every outcome must sit under a category.');
  if (!Array.isArray(src.functions) || !src.functions.length) {
    say('"functions" must be a list with at least one function.');
    return { errors };
  }

  const fnCodes = new Set<string>();
  const catCodes = new Set<string>();
  const outCodes = new Set<string>();
  let outcomes = 0;
  const functions = (src.functions as Row[]).map((f, i) => {
    const at = `Function ${i + 1}`;
    const code = text(f?.code);
    if (!code || !text(f?.name)) say(`${at}: a function needs a "code" and a "name".`);
    const label = code || at;
    if (code && fnCodes.has(code.toLowerCase())) say(`Function code ${code} is used more than once.`);
    fnCodes.add(code.toLowerCase());
    if (f?.color !== undefined && !COLOURS.includes(f.color)) say(`${label}: "color" must be one of ${COLOURS.join(', ')}.`);
    if (f && 'outcomes' in f) say(`${label}: outcomes are listed directly under the function. Every outcome must sit under a category.`);
    if (f?.categories !== undefined && !Array.isArray(f.categories)) say(`${label}: "categories" must be a list.`);
    const categories = (Array.isArray(f?.categories) ? (f.categories as Row[]) : []).map((c, j) => {
      const ccode = text(c?.code);
      const clabel = ccode || `${label}, category ${j + 1}`;
      if (!ccode || !text(c?.name)) say(`${clabel}: a category needs a "code" and a "name".`);
      if (ccode && catCodes.has(ccode.toLowerCase())) say(`Category code ${ccode} is used more than once.`);
      catCodes.add(ccode.toLowerCase());
      if (c?.outcomes !== undefined && !Array.isArray(c.outcomes)) say(`${clabel}: "outcomes" must be a list.`);
      const list = (Array.isArray(c?.outcomes) ? (c.outcomes as Row[]) : []).map((o, k) => {
        const ocode = text(o?.code);
        if (!ocode) say(`${clabel}: outcome ${k + 1} has no "code".`);
        else if (ocode.length > 60) say(`Outcome code ${ocode.slice(0, 20)}... is longer than 60 characters.`);
        if (!text(o?.text)) say(`${ocode || `${clabel}, outcome ${k + 1}`}: an outcome needs its "text".`);
        if (ocode && outCodes.has(ocode.toLowerCase())) say(`Outcome code ${ocode} is used more than once.`);
        outCodes.add(ocode.toLowerCase());
        outcomes += 1;
        return { code: ocode, text: text(o?.text) };
      });
      return { code: ccode, name: text(c?.name), description: optional(c?.description), outcomes: list };
    });
    return { code, name: text(f?.name), description: optional(f?.description), color: f?.color as string | undefined, categories };
  });
  if (outcomes > MAX_OUTCOMES) say(`The file holds ${outcomes} outcomes; the most that can be loaded at once is ${MAX_OUTCOMES}.`);
  if (errors.length) return { errors };
  return {
    errors,
    ref: { key, name: text(src.name), version: optional(src.version), description: optional(src.description), functions },
  };
}

export interface ImportResult {
  framework_id: string | null;
  key: string;
  name: string;
  created: boolean;
  dry_run: boolean;
  functions: number;
  categories: number;
  outcomes: { total: number; added: number; updated: number; unchanged: number };
  /** Codes that exist in the application but are not in the file. They are left alone. */
  not_in_file: string[];
}

/** Loads (or, with `dryRun`, only measures) a validated reference file. */
export async function applyReference(ctx: ModuleContext, ref: ReferenceFramework, req: FastifyRequest | null, dryRun = false): Promise<ImportResult> {
  const { db } = ctx;
  let fw = await db.one<Row>('select * from frameworks where lower(key) = lower($1) and deleted_at is null', [ref.key]);
  const created = !fw;
  const flat = flattenReference(ref);
  const existing = fw
    ? new Map((await db.query<Row>('select id, code, official_text, function_code, category_code from framework_outcomes where framework_id = $1 and deleted_at is null', [fw.id]))
      .map((r) => [r.code as string, r]))
    : new Map<string, Row>();
  const differs = (o: (typeof flat)[number], row: Row) =>
    row.official_text !== o.text || row.function_code !== o.function_code || row.category_code !== o.category_code;
  const added = flat.filter((o) => !existing.has(o.code));
  const updated = flat.filter((o) => existing.has(o.code) && differs(o, existing.get(o.code)!));
  const inFile = new Set(flat.map((o) => o.code));
  const result: ImportResult = {
    framework_id: fw?.id ?? null, key: fw?.key ?? ref.key, name: ref.name, created, dry_run: dryRun,
    functions: ref.functions.length,
    categories: ref.functions.reduce((n, f) => n + f.categories.length, 0),
    outcomes: { total: flat.length, added: added.length, updated: updated.length, unchanged: flat.length - added.length - updated.length },
    not_in_file: [...existing.keys()].filter((c) => !inFile.has(c)).sort(),
  };
  if (dryRun) return result;

  const details = { name: ref.name, version: ref.version ?? null, description: ref.description ?? null };
  if (!fw) fw = await ctx.resources.create('framework', { key: ref.key, ...details }, req);
  else if (fw.name !== details.name || (fw.version ?? null) !== details.version || (fw.description ?? null) !== details.description) {
    await ctx.resources.update('framework', fw.id, details, req);
  }
  await saveStructure(ctx, fw.id, ref.functions as unknown as Row[]);
  for (const o of added) {
    await ctx.resources.create('framework_outcome', {
      framework_id: fw.id, code: o.code, function_code: o.function_code, category_code: o.category_code, official_text: o.text,
    }, req);
  }
  for (const o of updated) {
    await ctx.resources.update('framework_outcome', existing.get(o.code)!.id, {
      official_text: o.text, function_code: o.function_code, category_code: o.category_code,
    }, req);
  }
  await ctx.audit(req, {
    action: 'framework.import', recordType: 'framework', recordId: fw.id,
    summary: `${created ? 'Loaded' : 'Reloaded'} ${ref.name} from a reference file: ${added.length} outcome(s) added, ${updated.length} updated, ${result.outcomes.unchanged} unchanged`,
    after: { functions: result.functions, categories: result.categories, outcomes: result.outcomes },
  });
  return { ...result, framework_id: fw.id, key: fw.key };
}

/** A framework written back out in the reference-file shape (a starting point for another file). */
export async function exportReference(ctx: ModuleContext, fw: Row): Promise<ReferenceFramework> {
  const functions = await ctx.db.query<Row>('select code, name, description, color from framework_functions where framework_id = $1 order by sort, code', [fw.id]);
  const categories = await ctx.db.query<Row>('select function_code, code, name, description from framework_categories where framework_id = $1 order by sort, code', [fw.id]);
  const outcomes = await ctx.db.query<Row>('select code, category_code, official_text from framework_outcomes where framework_id = $1 and deleted_at is null order by code', [fw.id]);
  return {
    key: fw.key, name: fw.name, version: fw.version ?? undefined, description: fw.description ?? undefined,
    functions: functions.map((f) => ({
      code: f.code, name: f.name, description: f.description ?? undefined, color: f.color,
      categories: categories.filter((c) => c.function_code === f.code).map((c) => ({
        code: c.code, name: c.name, description: c.description ?? undefined,
        outcomes: outcomes.filter((o) => o.category_code === c.code).map((o) => ({ code: o.code, text: o.official_text ?? '' })),
      })),
    })),
  };
}
