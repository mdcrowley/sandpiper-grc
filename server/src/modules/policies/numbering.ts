// Document numbers (E43): the controlled number people quote (SOP-IT-014), beside the immutable
// internal reference (POL-00001). Worked out from a pattern (setting `policies.number_pattern`),
// the document type's `meta.prefix`, the owning department's short code (document_department_codes)
// and a sequence per (type, department code). Unique among undeleted documents, case-insensitive;
// a number is never handed out twice (the sequence only moves forward, and numbers already taken,
// such as ones loaded from an organization's own register, are skipped).
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';

export const NUMBER_PATTERN_SETTING = 'policies.number_pattern';
export const DEFAULT_NUMBER_PATTERN = '{prefix}-{dept}-{seq:3}';
const TOKEN = /\{(prefix|dept|year|seq)(?::(\d))?\}/g;
export const CODE_RE = /^[A-Z0-9]{1,10}$/;
export const MAX_NUMBER_LENGTH = 60;

/** Checks a pattern: it must hold {seq} and only known tokens. Returns a message, or null when it is fine. */
export function patternProblem(pattern: unknown): string | null {
  if (typeof pattern !== 'string' || !pattern.trim()) return 'Enter a pattern.';
  if (pattern.length > 60) return 'The pattern is too long.';
  if (!/\{seq(?::\d)?\}/.test(pattern)) return 'The pattern must include {seq} (the running number).';
  const rest = pattern.replace(TOKEN, '');
  if (/[{}]/.test(rest)) return 'Use only {prefix}, {dept}, {year} and {seq} or {seq:N}.';
  if (!/^[A-Za-z0-9 ._/-]*$/.test(rest)) return 'Use letters, digits, spaces and . _ / - between the parts.';
  return null;
}

export async function numberPattern(ctx: ModuleContext): Promise<string> {
  const p = await ctx.settings.get<unknown>(NUMBER_PATTERN_SETTING, DEFAULT_NUMBER_PATTERN);
  return patternProblem(p) ? DEFAULT_NUMBER_PATTERN : String(p);
}

/**
 * Fills a pattern. An empty part ({dept} with no code, {prefix} with none) is dropped together with
 * the separator after it, so `{prefix}-{dept}-{seq:3}` gives `POL-001` for a document with no department.
 */
export function formatNumber(pattern: string, parts: { prefix: string; dept: string; year: string; seq: number }): string {
  let out = pattern.replace(/\{(prefix|dept|year)\}([-._/ ]?)/g, (_m, key: 'prefix' | 'dept' | 'year', sep: string) => {
    const v = parts[key];
    return v ? `${v}${sep}` : '';
  });
  out = out.replace(/\{seq(?::(\d))?\}/g, (_m, width?: string) => String(parts.seq).padStart(Number(width ?? 1), '0'));
  return out.replace(/[-._/ ]+$/, '');
}

/** The type's prefix (list policy_document_type, meta.prefix), else the first letters of its value. */
async function prefixOf(ctx: ModuleContext, type: string | null): Promise<string> {
  const v = (await ctx.lookups.values('policy_document_type')).find((x) => x.value === type);
  const p = String((v?.meta as Row | undefined)?.prefix ?? '').trim().toUpperCase();
  if (/^[A-Z0-9]{1,10}$/.test(p)) return p;
  return String(type ?? 'DOC').replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'DOC';
}

export async function departmentCode(ctx: ModuleContext, departmentId: unknown): Promise<string> {
  if (!departmentId) return '';
  return (await ctx.db.one<{ code: string }>('select code from document_department_codes where department_id = $1', [departmentId]))?.code ?? '';
}

/** Whether a number is taken by another undeleted document. */
export async function numberTaken(ctx: ModuleContext, number: string, exceptId?: string | null): Promise<boolean> {
  return !!(await ctx.db.one(
    'select 1 from policies where lower(doc_number) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)', [number, exceptId ?? null]));
}

/** The next free number for a document of this type and department (moves the sequence on). */
export async function nextNumber(ctx: ModuleContext, p: { document_type?: unknown; owning_department_id?: unknown; id?: string | null }): Promise<string> {
  const pattern = await numberPattern(ctx);
  const type = String(p.document_type ?? 'policy');
  const prefix = await prefixOf(ctx, type);
  const usesDept = pattern.includes('{dept}');
  const dept = usesDept ? await departmentCode(ctx, p.owning_department_id) : '';
  const year = todayInZone().slice(0, 4);
  for (let tries = 0; tries < 1000; tries++) {
    const row = await ctx.db.one<{ n: number }>(
      `insert into document_number_sequences (type, dept_code, next) values ($1, $2, 2)
       on conflict (type, dept_code) do update set next = document_number_sequences.next + 1
       returning next - 1 as n`, [type, dept]);
    const candidate = formatNumber(pattern, { prefix, dept, year, seq: Number(row!.n) });
    if (!(await numberTaken(ctx, candidate, p.id ?? null))) return candidate;
  }
  return ctx.fail(409, 'numbering', 'No free document number could be found. Check the numbering pattern.');
}

/** Cleans a number typed by hand: trimmed, at most MAX_NUMBER_LENGTH, printable. Returns null for empty. */
export function cleanNumber(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
}
