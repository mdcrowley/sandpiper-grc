import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { knownNames, parseMapping, parseMappings } from './mappings.ts';
import { flattenReference, loadCsf2, type ReferenceFramework } from './reference.ts';
import { DEFAULT_STATUS, saveStructure } from './structure.ts';

export const DESIGNATIONS_FILE = 'csf_subcategory_designations.csv';
export const PROFILE_FILE = 'csf_target_profile.psv';
export const MISSING_TEXT = '(outcome text to be added)';
export const BASELINE = 'Baseline';

const CODE = /^[A-Z]{2}\.[A-Z]{2}-\d{2}$/;

// The "also satisfies" parser lives in mappings.ts; it is re-exported here for older imports.
export { parseMapping, parseMappings };

const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const slug = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Reads a column by header name without caring about case, spaces or underscores. */
function cell(row: Row, ...names: string[]): string {
  const wanted = names.map((n) => slug(n).replace(/_/g, ''));
  for (const [k, v] of Object.entries(row)) {
    if (wanted.includes(slug(k).replace(/_/g, ''))) return String(v ?? '').trim();
  }
  return '';
}

/** Creates the framework with its functions and categories if they are not there yet. */
export async function ensureFramework(ctx: ModuleContext, ref: ReferenceFramework): Promise<Row> {
  let fw = await ctx.db.one<Row>('select * from frameworks where lower(key) = lower($1) and deleted_at is null', [ref.key]);
  if (!fw) {
    fw = await ctx.resources.create('framework', {
      key: ref.key, name: ref.name, version: ref.version ?? null, description: ref.description ?? null,
    });
  }
  const have = await ctx.db.one<{ c: number }>('select count(*)::int as c from framework_categories where framework_id = $1', [fw.id]);
  const want = ref.functions.reduce((n, f) => n + f.categories.length, 0);
  if ((have?.c ?? 0) < want) await saveStructure(ctx, fw.id, ref.functions as unknown as Row[]);
  return fw;
}

async function outcomesByCode(ctx: ModuleContext, frameworkId: string): Promise<Map<string, Row>> {
  const rows = await ctx.db.query<Row>('select * from framework_outcomes where framework_id = $1 and deleted_at is null', [frameworkId]);
  return new Map(rows.map((r) => [r.code as string, r]));
}

async function ensureBaseline(ctx: ModuleContext, frameworkId: string): Promise<boolean> {
  const has = await ctx.db.one(
    'select 1 from assessment_snapshots where framework_id = $1 and lower(name) = lower($2) and deleted_at is null', [frameworkId, BASELINE]);
  if (has) return false;
  await ctx.resources.create('assessment_snapshot', {
    framework_id: frameworkId, name: BASELINE, notes: 'Starting position, recorded when the target profile was first loaded.',
  });
  return true;
}

// ---------- pilot: the organization's own files (each is optional) ----------

async function seedPilot(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const ref = loadCsf2();
  const fw = await ensureFramework(ctx, ref);
  const refText = new Map(flattenReference(ref).map((o) => [o.code, o]));
  const categories = new Set((await ctx.db.query<{ code: string }>('select code from framework_categories where framework_id = $1', [fw.id])).map((c) => c.code));
  const functions = new Set((await ctx.db.query<{ code: string }>('select code from framework_functions where framework_id = $1', [fw.id])).map((f) => f.code));

  // 1. Outcomes: the designations file decides which identifiers exist.
  const hasDesignations = existsSync(join(opts.seedDir, DESIGNATIONS_FILE));
  const designations = hasDesignations ? ctx.readSeed(opts, DESIGNATIONS_FILE, ',') : [];
  let existing = await outcomesByCode(ctx, fw.id);
  const fileCodes = new Set<string>();
  const lackingText: string[] = [];
  const malformed: string[] = [];
  let created = 0;
  for (const row of designations) {
    const code = cell(row, 'id', 'identifier', 'subcategory').toUpperCase();
    const rating = cell(row, 'focus_area_ratings', 'designation', 'rating').toUpperCase();
    if (!CODE.test(code)) { malformed.push(code || '(blank)'); continue; }
    if (fileCodes.has(code)) continue;
    fileCodes.add(code);
    const known = refText.get(code);
    if (!known) lackingText.push(code);
    const functionCode = code.slice(0, 2);
    const categoryCode = code.slice(0, 5);
    // An identifier outside the shipped reference data still needs somewhere to sit on the board.
    if (!functions.has(functionCode) || !categories.has(categoryCode)) {
      const fn = ref.functions.find((f) => f.code === functionCode);
      if (!functions.has(functionCode)) {
        await ctx.db.query(
          `insert into framework_functions (framework_id, code, name, sort) values ($1,$2,$2,900) on conflict do nothing`, [fw.id, functionCode]);
        functions.add(functionCode);
      }
      await ctx.db.query(
        `insert into framework_categories (framework_id, function_code, code, name, sort) values ($1,$2,$3,$3,$4) on conflict do nothing`,
        [fw.id, functionCode, categoryCode, (ref.functions.indexOf(fn!) + 1 || 90) * 1000 + 900]);
      categories.add(categoryCode);
    }
    const priority = rating.includes('E');
    const current = existing.get(code);
    if (!current) {
      await ctx.resources.create('framework_outcome', {
        framework_id: fw.id, code, function_code: functionCode, category_code: categoryCode,
        official_text: known?.text ?? MISSING_TEXT, priority, designation: rating || null,
      });
      created += 1;
      continue;
    }
    const patch: Row = {};
    if (known && (empty(current.official_text) || current.official_text === MISSING_TEXT)) patch.official_text = known.text;
    if (empty(current.designation) && rating) {
      patch.designation = rating;
      if (priority && !current.priority) patch.priority = true;
    }
    if (Object.keys(patch).length) await ctx.resources.update('framework_outcome', current.id, patch);
  }

  // 2. Target profile: fills fields that are still empty; never overwrites later edits.
  existing = await outcomesByCode(ctx, fw.id);
  const statuses = await ctx.lookups.values('outcome_status');
  const phases = await ctx.lookups.values('outcome_phase');
  const match = (list: { value: string; label: string }[], text: string) =>
    list.find((v) => v.value === slug(text) || slug(v.label) === slug(text))?.value;
  const hasProfile = existsSync(join(opts.seedDir, PROFILE_FILE));
  const profile = hasProfile ? ctx.readSeed(opts, PROFILE_FILE, '|') : [];
  const unmatched: string[] = [];
  let applied = 0;
  let changed = 0;
  let mappingsAdded = 0;
  // Names containing a number are split correctly when they are in the configurable list or already in use.
  const names = await knownNames(ctx);
  for (const row of profile) {
    const code = cell(row, 'ID').toUpperCase();
    const o = existing.get(code);
    if (!o) { unmatched.push(code || '(blank)'); continue; }
    applied += 1;
    const patch: Row = {};
    const fill = (field: string, value: string) => { if (value && empty(o[field])) patch[field] = value; };
    fill('description', cell(row, 'Outcome'));
    fill('evidence_summary', cell(row, 'Evidence'));
    fill('target', cell(row, 'Target'));
    fill('first_action', cell(row, 'FirstAction'));
    fill('also_satisfies', cell(row, 'AlsoSatisfies'));
    const phase = match(phases, cell(row, 'Phase'));
    if (phase && empty(o.phase)) patch.phase = phase;
    // The status is only set the first time this outcome's profile row is applied, and only
    // while it still has the starting value, so a status changed by a person always stands.
    const status = match(statuses, cell(row, 'Status'));
    if (status && !o.profile_applied_at && o.status === DEFAULT_STATUS && status !== o.status) patch.status = status;
    if (Object.keys(patch).length) {
      await ctx.resources.update('framework_outcome', o.id, patch);
      changed += 1;
    }
    if (!o.profile_applied_at) await ctx.db.query('update framework_outcomes set profile_applied_at = now() where id = $1', [o.id]);

    const added: Row[] = [];
    for (const m of parseMappings(cell(row, 'AlsoSatisfies'), names)) {
      const made = await ctx.db.one<Row>(
        `insert into outcome_mappings (outcome_id, framework_name, reference) values ($1,$2,$3)
         on conflict do nothing returning framework_name, reference`, [o.id, m.framework_name, m.reference]);
      if (made) added.push(made);
    }
    if (added.length) {
      mappingsAdded += added.length;
      await ctx.audit(null, {
        action: 'framework_outcome.mapping_add', recordType: 'framework_outcome', recordId: o.id,
        summary: `${code} mapped to ${added.length} other framework reference${added.length === 1 ? '' : 's'} (seed)`, after: added,
      });
    }
  }

  // The baseline records the starting position of a loaded profile: without one there is nothing to record.
  const baseline = hasProfile ? await ensureBaseline(ctx, fw.id) : false;

  const total = await ctx.db.one<{ c: number; p: number }>(
    `select count(*)::int as c, count(*) filter (where priority)::int as p from framework_outcomes where framework_id = $1 and deleted_at is null`, [fw.id]);
  const notInFile = [...refText.keys()].filter((c) => !fileCodes.has(c));
  const parts = [
    `${total!.c} outcomes (${created} new)`,
    `${total!.p} priority`,
    hasProfile ? `${applied} profile rows applied (${changed} changed an outcome this run)` : `no ${PROFILE_FILE} in the seed folder, target profile skipped`,
    `${mappingsAdded} cross-mappings added`,
    baseline ? `snapshot "${BASELINE}" created` : hasProfile ? `snapshot "${BASELINE}" already there` : `snapshot "${BASELINE}" not taken`,
    !hasDesignations ? `no ${DESIGNATIONS_FILE} in the seed folder, outcomes not loaded (add them on the framework page or run the dev profile)` : lackingText.length ? `identifiers lacking outcome text: ${lackingText.join(', ')}` : 'every identifier has outcome text',
  ];
  if (malformed.length) parts.push(`skipped malformed identifiers: ${malformed.join(', ')}`);
  if (unmatched.length) parts.push(`profile rows with no matching outcome: ${unmatched.join(', ')}`);
  if (hasDesignations && notInFile.length) parts.push(`in reference data but not in the designations file (not loaded): ${notInFile.join(', ')}`);
  return parts.join('; ');
}

// ---------- dev: generated sample data ----------

async function seedDev(ctx: ModuleContext): Promise<string> {
  const ref = loadCsf2();
  const fw = await ensureFramework(ctx, ref);
  const existing = await outcomesByCode(ctx, fw.id);
  const all = flattenReference(ref);
  let created = 0;
  for (const [i, o] of all.entries()) {
    if (existing.has(o.code)) continue;
    await ctx.resources.create('framework_outcome', {
      framework_id: fw.id, code: o.code, function_code: o.function_code, category_code: o.category_code,
      official_text: o.text, priority: i % 2 === 0, designation: i % 2 === 0 ? 'ESS' : 'SSS',
    });
    created += 1;
  }

  // Sample history only on a fresh database, so re-running never disturbs later edits.
  const snapshots = await ctx.db.one<{ c: number }>(
    'select count(*)::int as c from assessment_snapshots where framework_id = $1 and deleted_at is null', [fw.id]);
  let story = 'sample history already there';
  if (!snapshots!.c && created === all.length) {
    const byCode = await outcomesByCode(ctx, fw.id);
    const sample = all.filter((_, i) => i % 5 === 0).slice(0, 20);
    const phases = ['now', 'next', 'later'];
    const set = async (codes: typeof sample, status: (i: number) => string, extra = false) => {
      for (const [i, o] of codes.entries()) {
        await ctx.resources.update('framework_outcome', byCode.get(o.code)!.id, {
          status: status(i),
          ...(extra ? {
            phase: phases[i % 3],
            target: 'Written down, in use, and reviewed at least once a year',
            first_action: 'Agree an owner and record what is in place today',
          } : {}),
        });
      }
    };
    const dated = async (name: string, daysAgo: number, notes: string) => {
      const d = (await ctx.db.one<{ d: string }>(`select (current_date - $1::int)::text as d`, [daysAgo]))!.d;
      await ctx.resources.create('assessment_snapshot', { framework_id: fw.id, name, taken_on: d, notes });
    };
    await set(sample, (i) => (i % 4 === 0 ? 'partial' : DEFAULT_STATUS), true);
    await dated(BASELINE, 56, 'Sample data: starting position.');
    await set(sample.slice(0, 14), (i) => (i % 3 === 0 ? 'largely_met' : 'partial'));
    await dated('Mid-quarter review', 14, 'Sample data: six weeks of progress.');
    await set(sample.slice(0, 6), (i) => (i % 2 === 0 ? 'met' : 'largely_met'));
    story = `sample statuses on ${sample.length} outcomes and 2 snapshots`;
  }
  const total = await ctx.db.one<{ c: number; p: number }>(
    `select count(*)::int as c, count(*) filter (where priority)::int as p from framework_outcomes where framework_id = $1 and deleted_at is null`, [fw.id]);
  return `${total!.c} outcomes (${created} new); ${total!.p} priority; ${story}`;
}

export async function seedFrameworks(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  return opts.profile === 'dev' ? seedDev(ctx) : seedPilot(ctx, opts);
}
