import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { localDate, text, UUID } from './dates.ts';
import { loadUsers, resolvePerson, saveTraining } from './people.ts';
import { completionInput } from './records.ts';
import { syncTrainingAssignments } from './sync.ts';

/**
 * Completion import: CSV text + column mapping, with a dry run. Follows the asset import:
 * every row is checked first, rows with errors are never written, duplicates are skipped.
 */

const MAX_ROWS = 5000;

/** What a CSV column can be mapped to. */
export const IMPORT_FIELDS: Record<string, string> = {
  course: 'Course',
  person_email: 'Email',
  person_name: 'Name',
  person_department: 'Department',
  completed_on: 'Completed on',
  score: 'Score',
  result: 'Result',
  evidence_note: 'Evidence note',
};

/** RFC 4180-style parser: quoted cells, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const src = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD and month/day/year; returns YYYY-MM-DD or null. */
export function parseDate(v: string): string | null {
  const p = (n: string) => n.padStart(2, '0');
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(v);
  let out: string | null = null;
  if (m) out = `${m[1]}-${p(m[2])}-${p(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) out = `${m[3]}-${p(m[1])}-${p(m[2])}`;
  if (!out) return null;
  const d = new Date(`${out}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out ? out : null;
}

export function registerImport(ctx: ModuleContext) {
  /**
   * Body: { csv, mapping: { <field>: <CSV column header> }, course_id?, dryRun (default true), delimiter (default ",") }.
   * Fields are the keys of IMPORT_FIELDS. `course_id` is the course for rows when no column is mapped to "course".
   * A duplicate is a row whose person, course and completion date match an existing record or an earlier row.
   */
  ctx.app.post('/api/training/import', { preHandler: ctx.requirePerm('training.create') }, async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as Row;
    const dryRun = body.dryRun !== false;
    if (typeof body.csv !== 'string' || !body.csv.trim()) ctx.fail(400, 'validation', 'Paste or upload a CSV file first.', { csv: 'The CSV text is empty.' });
    const delimiter = typeof body.delimiter === 'string' && body.delimiter.length === 1 ? body.delimiter : ',';
    const [header, ...lines] = parseCsv(body.csv, delimiter);
    const headers = (header ?? []).map((h) => h.trim());
    if (!lines.length) ctx.fail(400, 'validation', 'The file has a header row but no data rows.', { csv: 'No data rows found.' });
    if (lines.length > MAX_ROWS) ctx.fail(400, 'validation', `Import at most ${MAX_ROWS} rows at a time.`, { csv: `The file has ${lines.length} rows.` });

    const mapping = (body.mapping && typeof body.mapping === 'object' ? body.mapping : {}) as Record<string, string>;
    const mapErrors: Record<string, string> = {};
    const columns: [string, number][] = [];
    for (const [field, column] of Object.entries(mapping)) {
      if (!column) continue;
      const at = headers.findIndex((h) => h.toLowerCase() === String(column).trim().toLowerCase());
      if (!IMPORT_FIELDS[field]) mapErrors[field] = `"${field}" is not a field that can be imported.`;
      else if (at < 0) mapErrors[field] = `The file has no column called "${column}".`;
      else columns.push([field, at]);
    }
    const mapped = (f: string) => columns.some(([k]) => k === f);
    if (!mapped('person_email') && !mapped('person_name') && !mapErrors.person_email) mapErrors.person_email = 'Map a column to Email or to Name; every row needs a person.';
    if (!mapped('completed_on') && !mapErrors.completed_on) mapErrors.completed_on = 'Map a column to Completed on.';

    const courses = await ctx.db.query<Row>('select * from courses where deleted_at is null');
    const fixedCourse = text(body.course_id) ? courses.find((c) => c.id === body.course_id) : undefined;
    if (text(body.course_id) && !fixedCourse) mapErrors.course = 'The chosen course was not found.';
    if (!mapped('course') && !fixedCourse && !mapErrors.course) mapErrors.course = 'Choose a course, or map a column to Course.';
    if (Object.keys(mapErrors).length) ctx.fail(400, 'mapping', 'Check the column mapping.', mapErrors);

    const key = (s: unknown) => String(s ?? '').trim().toLowerCase();
    const courseBy = new Map<string, Row>();
    for (const c of courses) {
      if (c.ref) courseBy.set(key(c.ref), c);
      if (!courseBy.has(key(c.title))) courseBy.set(key(c.title), c);
    }
    const users = await loadUsers(ctx);
    const today = localDate();
    const existing = new Set((await ctx.db.query<Row>(
      `select course_id, person_key, completed_on from training_records where deleted_at is null and completed_on is not null`,
    )).map((r) => `${r.course_id}|${r.person_key}|${r.completed_on}`));
    const seen = new Map<string, number>();

    const rows: Row[] = [];
    const summary = { total: lines.length, valid: 0, errors: 0, duplicates: 0, created: 0, updated: 0, skipped: 0 };
    const touched = new Set<string>();

    for (const [i, cells] of lines.entries()) {
      const line = i + 2; // line 1 is the header
      const raw: Row = {};
      for (const [field, at] of columns) raw[field] = (cells[at] ?? '').trim();
      const errors: Record<string, string> = {};

      let course = fixedCourse;
      if (mapped('course') && raw.course) {
        course = UUID.test(raw.course) ? courses.find((c) => c.id === raw.course) : courseBy.get(key(raw.course));
        if (!course) errors.course = `No course matches "${raw.course}".`;
      } else if (!course) errors.course = 'Course is required.';

      const person = resolvePerson({ name: raw.person_name, email: raw.person_email, department: raw.person_department }, users);
      if (typeof person === 'string') errors[mapped('person_email') ? 'person_email' : 'person_name'] = person;

      const date = raw.completed_on ? parseDate(raw.completed_on) : null;
      if (!raw.completed_on) errors.completed_on = 'Completed on is required.';
      else if (!date) errors.completed_on = `"${raw.completed_on}" is not a date (use YYYY-MM-DD or month/day/year).`;
      const checked = await completionInput(ctx, { completed_on: date ?? undefined, score: raw.score, result: raw.result, evidence_note: raw.evidence_note }, today);
      for (const [k, m] of Object.entries(checked.errors)) if (!errors[k]) errors[k] = m;

      const data: Row = {
        course: course ? course.title : raw.course ?? null,
        person: typeof person === 'string' ? raw.person_name || raw.person_email || null : person.label,
        has_account: typeof person === 'string' ? false : !!person.user_id,
        person_department: raw.person_department || null,
        ...checked.data,
      };

      let duplicate: Row | null = null;
      const dupKey = course && typeof person !== 'string' && date ? `${course.id}|${person.key}|${date}` : null;
      if (dupKey) {
        if (seen.has(dupKey)) duplicate = { of: 'file', line: seen.get(dupKey) };
        else if (existing.has(dupKey)) duplicate = { of: 'existing' };
        if (!seen.has(dupKey)) seen.set(dupKey, line);
      }

      const hasErrors = Object.keys(errors).length > 0;
      let action: 'create' | 'skip' | 'error' = hasErrors ? 'error' : duplicate ? 'skip' : 'create';
      const out: Row = { line, data, errors, duplicate, action };

      if (!dryRun && action === 'create') {
        try {
          const saved = await saveTraining(ctx.db, course!, person as Exclude<typeof person, string>, checked.data, 'import', today, req.user!.id);
          out.id = saved.id;
          out.outcome = saved.outcome;
          // A failed attempt is noted on the record to complete; it is not a completion.
          if (saved.outcome === 'completed' || saved.outcome === 'attempted') summary.updated++;
          else if (saved.outcome === 'created') summary.created++;
          else { action = out.action = 'skip'; out.duplicate = { of: 'existing' }; summary.duplicates++; }
          touched.add(course!.id);
        } catch (err) {
          out.errors = { _row: (err as Error).message ?? 'Could not be saved.' };
          action = out.action = 'error';
        }
      }
      if (action === 'error') summary.errors++;
      else {
        summary.valid++;
        if (action === 'create' && dryRun) summary.created++;
        if (action === 'skip') summary.skipped++;
      }
      if (duplicate) summary.duplicates++;
      rows.push(out);
    }

    if (dryRun) {
      // Nothing was written: report what a real run would do.
      return { dryRun, ...summary, wouldCreate: summary.created, created: 0, updated: 0, rows };
    }
    await ctx.audit(req, {
      action: 'training.import', recordType: 'training_record',
      summary: `Training import: ${summary.created} completions added, ${summary.updated} open records completed, ${summary.skipped} duplicates skipped, ${summary.errors} with errors (of ${summary.total} rows)`,
      after: { ...summary, mapping, course_id: fixedCourse?.id ?? null, courses: [...touched] },
    });
    await syncTrainingAssignments(ctx);
    return { dryRun, ...summary, rows };
  });
}
