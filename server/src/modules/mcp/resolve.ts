import { qs } from './caller.ts';
import { isUuid, type FieldMeta, type Meta, type ToolContext } from './toolkit.ts';

// Turning the values an assistant has in its sources into what the record routes take (E45-46, wave 25):
// a linked record by its id, reference or exact title; a person by user id, username, email or exact
// display name; a list value by its code or label; a date in a common format. Everything goes through
// routes the caller may use, so a record or person the caller may not see is never matched.

/** One value worked out from what was given, for the answer. */
export interface Resolution { field: string; given: unknown; value: unknown; label?: string | null }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | null {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // 2024-02-30
  return `${y}-${pad(m)}-${pad(d)}`;
}
const monthOf = (word: string) => {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
};

/**
 * A calendar date (YYYY-MM-DD) from the formats sources use: ISO (also with a time, which is cut off),
 * YYYY/MM/DD, MM/DD/YYYY (month first, as in the United States; a first number above 12 is read as
 * the day), "March 5, 2024", "5 March 2024", "Mar-05-2024", and an Excel serial day number. Null when
 * none fits.
 */
export function normalizeDate(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 20000 && raw < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86_400_000); // Excel serial date
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1]; const b = +m[2];
    return a > 12 ? ymd(+m[3], b, a) : ymd(+m[3], a, b);
  }
  m = /^([A-Za-z]{3,})\.?[ -](\d{1,2})(?:st|nd|rd|th)?,?[ -](\d{4})$/.exec(s);
  if (m && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,})\.?,?[ -](\d{4})$/.exec(s);
  if (m && monthOf(m[2])) return ymd(+m[3], monthOf(m[2]), +m[1]);
  return null;
}

const DATE_HELP = 'Give a date as YYYY-MM-DD (also accepted: MM/DD/YYYY, "March 5, 2024", "5 March 2024").';

/** Short help on how to give each kind of value, for list_record_types. */
export function valueHint(f: FieldMeta, meta: Meta): string | null {
  switch (f.type) {
    case 'ref': {
      const target = meta.resources[f.to ?? ''];
      const ex = target?.refField ? ', its reference (such as XYZ-00012)' : '';
      return `A ${(target?.label ?? f.to ?? 'record').toLowerCase()}: its id${ex} or its exact ${f.to === 'person' ? 'name or email' : 'title'}.`;
    }
    case 'user': return 'A person with an account: user id, username, email, exact display name, or "me".';
    case 'lookup': return f.multiple ? 'A list of choices (values or labels).' : 'One of the choices, by value or label.';
    case 'date': return DATE_HELP;
    case 'datetime': return 'A date and time, ISO 8601 (e.g. 2024-03-04T14:00:00Z; without a zone it is read as server time).';
    case 'boolean': return 'true or false (yes and no are accepted).';
    case 'number': case 'currency': return 'A number.';
    case 'json': return 'Structured data: give a JSON object or list as the value itself, not as text.';
    default: return null;
  }
}

type Hit = { id: string; label: string | null; ref: string | null };

/** Records of a type matching a key exactly (id, reference or title, any case), among those the caller may see. */
async function findRecords(t: ToolContext, to: string, key: string): Promise<{ exact: Hit[]; near: Hit[] }> {
  const meta = await t.meta();
  const target = meta.resources[to];
  const lower = key.toLowerCase();
  // The record picker's route: the caller's visibility, directories (departments) for everyone.
  const hits = (await t.api.tryGet<Hit[]>(`/api/records/lookup${qs({ type: to, q: key })}`)) ?? [];
  const byRef = hits.filter((h) => h.ref && String(h.ref).toLowerCase() === lower);
  if (byRef.length) return { exact: byRef, near: [] };
  let exact = hits.filter((h) => String(h.label ?? '').trim().toLowerCase() === lower);
  const seen = new Set(exact.map((h) => h.id));
  const more = async (field: string, values: string[]) => {
    if (!target) return;
    const r = await t.api.tryGet<{ rows: Record<string, any>[] }>(`${target.path}${qs({ [`f.${field}`]: [...new Set(values)].join(','), pageSize: 10 })}`);
    for (const row of r?.rows ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      exact.push({ id: row.id, label: row[target.titleField] ?? null, ref: target.refField ? row[target.refField] ?? null : null });
    }
  };
  // The picker answers at most 25 near matches: look for the exact title too when it may have been cut.
  if (!exact.length && hits.length >= 25) await more(target?.titleField ?? 'title', [key, key.toLowerCase(), key.toUpperCase()]);
  // People on the roster are often known by their email or employee number.
  if (!exact.length && to === 'person' && target) {
    if (target.fields.email) await more('email', [key, lower]);
    if (!exact.length && target.fields.employee_number) await more('employee_number', [key, key.toUpperCase()]);
  }
  if (exact.length > 1) exact = exact.filter((h, i, a) => a.findIndex((x) => x.id === h.id) === i);
  return { exact, near: hits.slice(0, 5) };
}

const hitName = (h: Hit) => `${h.ref ? `${h.ref} ` : ''}${h.label ?? ''}`.trim();

/**
 * Resolves the values of one save. Returns the values to send, what was worked out, and field errors
 * (each naming what was found, so the assistant can choose).
 */
export async function resolveValues(
  t: ToolContext, values: Record<string, unknown>, fieldOf: (name: string) => FieldMeta,
): Promise<{ out: Record<string, unknown>; resolved: Resolution[]; errors: Record<string, string> }> {
  const meta = await t.meta();
  const out: Record<string, unknown> = {};
  const resolved: Resolution[] = [];
  const errors: Record<string, string> = {};
  for (const [name, v] of Object.entries(values)) {
    const f = fieldOf(name);
    try {
      const r = await resolveOne(t, meta, f, v);
      out[name] = r.value;
      if (r.changed) resolved.push({ field: name, given: v, value: r.value, ...(r.label !== undefined ? { label: r.label } : {}) });
    } catch (err) {
      if (err instanceof FieldProblem) errors[name] = `${f.label}: ${err.message}`;
      else throw err;
    }
  }
  return { out, resolved, errors };
}

class FieldProblem extends Error {}
const problem = (msg: string): never => { throw new FieldProblem(msg); };

async function resolveOne(t: ToolContext, meta: Meta, f: FieldMeta, v: unknown): Promise<{ value: unknown; changed: boolean; label?: string | null }> {
  const same = { value: v, changed: false };
  if (v === null || v === undefined || v === '') return same;
  switch (f.type) {
    case 'user': {
      if (typeof v !== 'string') return same;
      if (v === 'me') return { value: t.session.user.id, changed: true, label: t.session.user.displayName };
      if (isUuid(v)) return same;
      const people = (await t.api.tryGet<{ id: string; name: string; by: string }[]>(`/api/mcp/people${qs({ q: v.trim() })}`)) ?? [];
      const strong = people.filter((p) => p.by !== 'name');
      const pick = strong.length === 1 ? strong : people;
      if (pick.length === 1) return { value: pick[0].id, changed: true, label: pick[0].name };
      if (pick.length > 1) problem(`"${v}" matches ${pick.length} people (${pick.slice(0, 5).map((p) => p.name).join('; ')}): give the username or email.`);
      return problem(`no ${t.session.dataLoad?.allowed ? '' : 'active '}account has the username, email or name "${v}".`
        + (t.session.dataLoad?.allowed ? '' : ' Disabled accounts can be named only in data load mode.'));
    }
    case 'ref': {
      if (typeof v !== 'string' && typeof v !== 'number') return same;
      const key = String(v).trim();
      if (isUuid(key)) return same;
      const to = f.to ?? '';
      const label = (meta.resources[to]?.label ?? to.replace(/_/g, ' ')).toLowerCase();
      const { exact, near } = await findRecords(t, to, key);
      if (exact.length === 1) return { value: exact[0].id, changed: true, label: hitName(exact[0]) };
      if (exact.length > 1) problem(`"${key}" matches ${exact.length} records (${exact.slice(0, 6).map(hitName).join('; ')}): give the reference or id.`);
      return problem(`no ${label} "${key}" that you can see${near.length ? `. Close matches: ${near.map(hitName).join('; ')}` : ''}. Give its id, reference or exact title, or create it first.`);
    }
    case 'lookup': {
      const choices = meta.lookups[f.list ?? ''];
      if (!choices) return same; // a list the caller may not read: the route decides
      const match = (x: unknown) => {
        const s = String(x).trim();
        return choices.find((c) => c.value === s) ?? choices.find((c) => c.value.toLowerCase() === s.toLowerCase() || c.label.toLowerCase() === s.toLowerCase());
      };
      const list = `Choices: ${choices.slice(0, 20).map((c) => (c.label && c.label !== c.value ? `${c.value} (${c.label})` : c.value)).join(', ')}${choices.length > 20 ? ', …' : ''}.`;
      if (f.multiple) {
        const items = Array.isArray(v) ? v : String(v).split(',');
        const vals = items.map((x) => String(x).trim()).filter(Boolean).map((x) => match(x)?.value ?? problem(`"${x}" is not one of the choices. ${list}`));
        const changed = JSON.stringify(vals) !== JSON.stringify(v);
        return { value: vals, changed };
      }
      const c = match(v);
      if (!c) return problem(`"${v}" is not one of the choices. ${list}`);
      return { value: c.value, changed: c.value !== v, label: c.label };
    }
    case 'date': {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return same;
      const d = normalizeDate(v);
      if (!d) return problem(`"${v}" is not a date I can read. ${DATE_HELP}`);
      return { value: d, changed: true };
    }
    case 'datetime': {
      if (typeof v !== 'string') return same;
      if (!Number.isNaN(Date.parse(v))) return same;
      const d = normalizeDate(v);
      if (d) return { value: d, changed: true };
      return problem(`"${v}" is not a date and time I can read. Give ISO 8601, e.g. 2024-03-04T14:00:00Z.`);
    }
    case 'boolean': {
      if (typeof v !== 'string') return same;
      const s = v.trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(s)) return { value: true, changed: s !== 'true' };
      if (['no', 'n', 'false', '0'].includes(s)) return { value: false, changed: s !== 'false' };
      return problem(`"${v}" is not yes or no.`);
    }
    case 'json': {
      if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return same;
      try { return { value: JSON.parse(v), changed: true }; } catch { return same; }
    }
    default:
      return same;
  }
}
