import { allTaggables } from '../../core/asset-tags.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import type { TagFormatInput, TryFormatRequest, TryFormatResult } from '../../../../shared/asset-tags-api.ts';
import {
  checkCharacter, cleanValue, compileSafePattern, extractFromCode, matchFormat, MAX_TAG_VALUE, valueKey,
  type CheckScheme, type FormatMismatch, type TagCarrier, type TagCharacters, type TagFormat, type TagSource,
} from '../../../../shared/tag-format.ts';
import { CHECK_NAMES, formatFromRow, invalid, loadFormats } from './common.ts';

// Tag formats (E37-02): what the organization's tags look like, and "try a value". Owned by TAGS-CORE.

const CHARACTERS: TagCharacters[] = ['digits', 'alphanumeric', 'pattern'];
const CHECKS: CheckScheme[] = ['none', 'mod10', 'mod11', 'mod36'];
const CARRIERS: TagCarrier[] = ['any', 'text', 'code', 'both'];
const SOURCES: TagSource[] = ['code', 'text', 'typed', 'handheld'];
const MAX_NAME = 80;
const MAX_PREFIX = 20;

const FORMAT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' }, characters: { type: 'string', enum: CHARACTERS }, pattern: { type: ['string', 'null'] },
    prefix: { type: 'string' }, lengthMin: { type: ['integer', 'null'] }, lengthMax: { type: ['integer', 'null'] },
    checkCharacter: { type: 'string', enum: CHECKS }, carrier: { type: 'string', enum: CARRIERS },
    extractPattern: { type: ['string', 'null'] }, recordTypes: { type: 'array', items: { type: 'string' } }, active: { type: 'boolean' },
  },
};

/** Columns for a format from the input merged over what is stored; throws 400 with field messages. */
export function checkFormat(ctx: ModuleContext, input: Partial<TagFormatInput>, stored: TagFormat | null): Row {
  const f: Record<string, string> = {};
  const merged = { ...(stored ?? {}), ...input } as Partial<TagFormatInput>;
  const name = typeof merged.name === 'string' ? merged.name.trim() : '';
  if (!name) f.name = 'Enter a name.';
  else if (name.length > MAX_NAME) f.name = `Use at most ${MAX_NAME} characters.`;
  const characters = merged.characters ?? 'digits';
  if (!CHARACTERS.includes(characters)) f.characters = 'Choose digits, letters and digits, or a pattern.';
  const prefix = typeof merged.prefix === 'string' ? cleanValue(merged.prefix) : '';
  if (merged.prefix !== undefined && merged.prefix !== null && typeof merged.prefix !== 'string') f.prefix = 'Enter text.';
  else if (prefix.length > MAX_PREFIX) f.prefix = `Use at most ${MAX_PREFIX} characters.`;
  const int = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const lengthMin = int(merged.lengthMin);
  const lengthMax = int(merged.lengthMax);
  for (const [k, v] of [['lengthMin', lengthMin], ['lengthMax', lengthMax]] as const) {
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > MAX_TAG_VALUE)) f[k] = `Enter a whole number from 1 to ${MAX_TAG_VALUE}.`;
  }
  if (!f.lengthMin && !f.lengthMax && lengthMin !== null && lengthMax !== null && lengthMin > lengthMax) f.lengthMax = 'The longest length cannot be shorter than the shortest.';
  const check = merged.checkCharacter ?? 'none';
  if (!CHECKS.includes(check)) f.checkCharacter = 'Choose none, mod 10, mod 11 or mod 36.';
  else if (characters === 'alphanumeric' && (check === 'mod10' || check === 'mod11')) {
    f.checkCharacter = `A ${CHECK_NAMES[check]} check digit works on digits only; choose mod 36 for letters and digits.`;
  }
  if (check !== 'none' && lengthMax !== null && lengthMax < 2) f.lengthMax = 'With a check character the number part has at least 2 characters.';
  const carrier = merged.carrier ?? 'any';
  if (!CARRIERS.includes(carrier)) f.carrier = 'Choose how tags carry the value.';
  let pattern: string | null = null;
  if (characters === 'pattern') {
    pattern = typeof merged.pattern === 'string' ? merged.pattern.trim() : '';
    const compiled = compileSafePattern(pattern);
    if (!compiled.ok) f.pattern = compiled.error;
  }
  let extractPattern: string | null = typeof merged.extractPattern === 'string' && merged.extractPattern.trim() ? merged.extractPattern.trim() : null;
  if (extractPattern) {
    const compiled = compileSafePattern(extractPattern);
    if (!compiled.ok) f.extractPattern = compiled.error;
    else if (!compiled.pattern.hasGroup) f.extractPattern = 'Mark the part that is the value with one pair of brackets ( ).';
  }
  if (carrier === 'text' && extractPattern) extractPattern = null; // printed text only: nothing to extract from
  const known = new Set(allTaggables(ctx.app).map((d) => d.type));
  const recordTypes = Array.isArray(merged.recordTypes) ? [...new Set(merged.recordTypes.map(String))] : [];
  if (merged.recordTypes !== undefined && !Array.isArray(merged.recordTypes)) f.recordTypes = 'Choose record types.';
  else if (recordTypes.some((t) => !known.has(t))) f.recordTypes = 'Choose from assets, sites, systems and vehicles.';
  const active = merged.active === undefined ? true : merged.active === true;
  if (Object.keys(f).length) invalid(ctx, f);
  return {
    name, characters, pattern, prefix, length_min: lengthMin, length_max: lengthMax, check_character: check, carrier,
    extract_pattern: extractPattern, record_types: JSON.stringify(recordTypes), active,
  };
}

const REASONS: Record<FormatMismatch, (f: TagFormat, value: string) => string> = {
  empty: () => 'There is no value to check.',
  too_long: () => `A tag value has at most ${MAX_TAG_VALUE} characters.`,
  carrier: (f) => `Tags of this format carry the value ${f.carrier === 'code' ? 'only as a barcode or 2D code' : 'only as printed text'}.`,
  prefix: (f) => `It does not start with ${f.prefix}.`,
  characters: (f) => (f.characters === 'alphanumeric' ? 'After the prefix it may hold only letters and digits.' : 'After the prefix it may hold only digits.'),
  length: (f) => `The part after the prefix must be ${lengthText(f)} long.`,
  check: (f, v) => checkMessage(f, v),
  pattern: () => 'It does not match the pattern.',
  bad_pattern: () => 'The format\'s pattern is not valid; correct it first.',
};

function lengthText(f: TagFormat): string {
  const n = (x: number) => `${x} character${x === 1 ? '' : 's'}`;
  if (f.lengthMin !== null && f.lengthMax !== null) return f.lengthMin === f.lengthMax ? n(f.lengthMin) : `${f.lengthMin} to ${n(f.lengthMax)}`;
  if (f.lengthMin !== null) return `at least ${n(f.lengthMin)}`;
  return `at most ${n(f.lengthMax ?? MAX_TAG_VALUE)}`;
}

function checkMessage(f: TagFormat, value: string): string {
  const numberPart = valueKey(value).slice(valueKey(f.prefix).length);
  const expected = numberPart.length > 1 ? checkCharacter(numberPart.slice(0, -1), f.checkCharacter) : null;
  const what = f.checkCharacter === 'mod36' ? 'check character' : 'check digit';
  return expected ? `The ${what} does not match (expected ${expected}).` : `The ${what} cannot be worked out for this value.`;
}

/** Whether and how a value matches each format (or one), as the "try a value" box shows it. */
export function tryValue(formats: TagFormat[], req: TryFormatRequest): TryFormatResult {
  const source = req.source ?? 'typed';
  const results = formats.map((format) => {
    let value = req.value;
    let extracted: string | null = null;
    if (source === 'code') {
      const x = extractFromCode(req.value, format);
      value = x.value;
      if (x.extracted) extracted = x.value;
    }
    const m = matchFormat(value, format, source);
    const message = m.ok
      ? `Matches${m.checked ? ', and the check character is right' : ''}${extracted ? ` (the value ${extracted} was taken from the code)` : ''}.`
      : REASONS[m.reason](format, value);
    return { formatId: format.id, name: format.name, ok: m.ok, reason: m.ok ? null : m.reason, message, extracted };
  });
  return { key: valueKey(req.value), results };
}

export function registerFormats(ctx: ModuleContext): void {
  const { app, db } = ctx;
  const one = async (id: unknown): Promise<TagFormat> => {
    const row = UUID_RE.test(String(id)) ? await db.one<Row>('select * from tag_formats where id = $1 and deleted_at is null', [id]) : undefined;
    return row ? formatFromRow(row) : ctx.fail(404, 'not_found', 'Tag format not found.');
  };

  app.get('/api/asset-tags/formats', { preHandler: ctx.requirePerm('tags.view') }, async () => loadFormats(db));
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/formats', summary: 'Tag formats', permission: 'tags.view',
    description: 'What the organization\'s tags look like (E37-02): characters, prefix, length, check character, carrier, extraction pattern and record types. Active formats first.',
    response: { type: 'array', items: FORMAT_SCHEMA },
  });

  app.post('/api/asset-tags/formats', { preHandler: ctx.requirePerm('tags.manage') }, async (req, reply) => {
    const cols = checkFormat(ctx, (req.body ?? {}) as Partial<TagFormatInput>, null);
    const row = (await db.one<Row>(
      `insert into tag_formats (name, characters, pattern, prefix, length_min, length_max, check_character, carrier, extract_pattern, record_types, active, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$12) returning *`,
      [cols.name, cols.characters, cols.pattern, cols.prefix, cols.length_min, cols.length_max, cols.check_character, cols.carrier,
        cols.extract_pattern, cols.record_types, cols.active, req.user!.id]))!;
    const format = formatFromRow(row);
    await ctx.audit(req, { action: 'tag.format.create', summary: `Tag format added: ${format.name}`, after: format });
    reply.code(201);
    return format;
  });
  ctx.describeRoute({ method: 'POST', path: '/api/asset-tags/formats', summary: 'Add a tag format', permission: 'tags.manage', body: FORMAT_SCHEMA, response: FORMAT_SCHEMA });

  app.patch('/api/asset-tags/formats/:id', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const before = await one((req.params as Row).id);
    const cols = checkFormat(ctx, (req.body ?? {}) as Partial<TagFormatInput>, before);
    const row = (await db.one<Row>(
      `update tag_formats set name = $2, characters = $3, pattern = $4, prefix = $5, length_min = $6, length_max = $7, check_character = $8,
         carrier = $9, extract_pattern = $10, record_types = $11::jsonb, active = $12, updated_at = now(), updated_by = $13
       where id = $1 returning *`,
      [before.id, cols.name, cols.characters, cols.pattern, cols.prefix, cols.length_min, cols.length_max, cols.check_character, cols.carrier,
        cols.extract_pattern, cols.record_types, cols.active, req.user!.id]))!;
    const after = formatFromRow(row);
    await ctx.audit(req, { action: 'tag.format.update', summary: `Tag format changed: ${after.name}`, before, after });
    return after;
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/asset-tags/formats/:id', summary: 'Change a tag format', permission: 'tags.manage', body: FORMAT_SCHEMA, response: FORMAT_SCHEMA });

  app.delete('/api/asset-tags/formats/:id', { preHandler: ctx.requirePerm('tags.manage') }, async (req) => {
    const before = await one((req.params as Row).id);
    const used = await db.one<{ n: number }>(
      `select ((select count(*) from tag_ranges where format_id = $1 and deleted_at is null) + (select count(*) from tag_series where format_id = $1 and deleted_at is null))::int as n`,
      [before.id]);
    if (used && used.n > 0) ctx.fail(409, 'in_use', 'Tag stock or a series uses this format. Switch it off instead, or remove that stock and series first.');
    await db.query('update tag_formats set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [before.id, req.user!.id]);
    await ctx.audit(req, { action: 'tag.format.delete', summary: `Tag format removed: ${before.name}`, before });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/asset-tags/formats/:id', summary: 'Remove a tag format (refused while stock or a series uses it)', permission: 'tags.manage' });

  app.post('/api/asset-tags/formats/try', { preHandler: ctx.requirePerm('tags.view') }, async (req) => {
    const b = (req.body ?? {}) as Partial<TryFormatRequest>;
    if (typeof b.value !== 'string' || !b.value.trim()) invalid(ctx, { value: 'Type a value to try.' });
    if (b.value!.length > 2000) invalid(ctx, { value: 'Use at most 2,000 characters.' });
    if (b.source !== undefined && !SOURCES.includes(b.source)) invalid(ctx, { source: 'Choose code, text, typed or handheld.' });
    const formats = b.formatId ? [await one(b.formatId)] : await loadFormats(db);
    return tryValue(formats, { value: b.value!, source: b.source, formatId: b.formatId });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/formats/try', summary: 'Try a value against the tag formats', permission: 'tags.view',
    description: 'Says, for each format (or the one named), whether the value matches and why not. With source `code` the format\'s extraction pattern is applied first.',
    body: { type: 'object', required: ['value'], properties: { value: { type: 'string' }, source: { type: 'string', enum: SOURCES }, formatId: { type: 'string' } } },
    response: { type: 'object', properties: { key: { type: 'string' }, results: { type: 'array', items: { type: 'object' } } } },
  });
}
