// "Also satisfies": the text on an outcome and the cross-mapping rows that back it.
//
// The text is a list of entries separated by semicolons. Each entry names another framework,
// law or condition and, optionally, a reference within it. Three ways to say where the name
// ends, tried in this order:
//   1. an explicit separator, a colon:            "Example Standard 2: 4.1"   (a trailing colon = no reference)
//   2. a name the installation already knows:     "ISO/IEC 27001 A.5.1"       (list `mapping_framework`,
//                                                  plus every name already used in a mapping)
//   3. otherwise the first word holding a digit starts the reference: "Example Guild 12.10.1"
// A trailing note in brackets becomes part of the reference.
import type { ModuleContext } from '../../core/module.ts';

export interface MappingPair { framework_name: string; reference: string }

/** The configurable list of other frameworks' names (Administration > Lists). */
export const NAMES_LIST = 'mapping_framework';

/** Starting values of that list: widely used international standards. Installations add their own. */
export const DEFAULT_NAMES = ['ISO/IEC 27001', 'SOC 2', 'PCI DSS', 'CIS Controls'];

const tidy = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

export function parseMapping(entry: string, known: string[] = DEFAULT_NAMES): MappingPair | null {
  let text = tidy(entry);
  if (!text) return null;
  let note = '';
  const bracket = text.match(/^(.*\S)\s+\(([^()]*)\)$/);
  if (bracket) {
    text = bracket[1].trim();
    note = bracket[2].trim();
  }
  let name = text;
  let reference = '';
  const colon = text.match(/^([^:]*[^:\s])\s*:(?:\s+(.*))?$/);
  const lower = text.toLowerCase();
  // The longest known name wins, so "Example Standard 2" beats "Example Standard".
  const match = [...known].map(tidy).filter(Boolean).sort((a, b) => b.length - a.length)
    .find((k) => lower === k.toLowerCase() || lower.startsWith(`${k.toLowerCase()} `));
  if (colon) {
    name = colon[1].trim();
    reference = (colon[2] ?? '').trim();
  } else if (match) {
    name = match;
    reference = text.slice(match.length).trim();
  } else {
    const words = text.split(' ');
    const at = words.findIndex((w, i) => i > 0 && /\d/.test(w));
    if (at > 0) {
      name = words.slice(0, at).join(' ');
      reference = words.slice(at).join(' ');
    }
  }
  if (note) reference = reference ? `${reference} (${note})` : note;
  return name ? { framework_name: name, reference } : null;
}

/** Splits the whole "also satisfies" text: entries are separated by semicolons. Duplicates are dropped. */
export function parseMappings(cell: string, known: string[] = DEFAULT_NAMES): MappingPair[] {
  const seen = new Set<string>();
  const out: MappingPair[] = [];
  for (const part of String(cell ?? '').split(';')) {
    const m = parseMapping(part, known);
    if (!m) continue;
    const key = pairKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export const pairKey = (m: MappingPair) => `${m.framework_name.toLowerCase()}|${m.reference.toLowerCase()}`;

/**
 * Writes mapping rows back as text that `parseMappings` reads to exactly the same rows,
 * whatever names are known: every entry carries the explicit separator.
 */
export function composeMappings(rows: MappingPair[]): string | null {
  const sorted = [...rows].sort((a, b) =>
    a.framework_name.toLowerCase().localeCompare(b.framework_name.toLowerCase()) || a.reference.localeCompare(b.reference, undefined, { numeric: true }));
  const text = sorted.map((m) => {
    // A bare name is safe to write alone only when rule 3 could not split it.
    if (!m.reference) {
      const ambiguous = /\d/.test(m.framework_name.split(' ').slice(1).join(' ')) || m.framework_name.endsWith(')');
      return ambiguous ? `${m.framework_name}:` : m.framework_name;
    }
    return `${m.framework_name}: ${m.reference}`;
  }).join('; ');
  return text || null;
}

/** Why a name or reference cannot be stored, or null. Semicolons and colons are the text's own separators. */
export function mappingProblem(m: MappingPair): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!m.framework_name) errors.framework_name = 'Name the other framework or requirement.';
  else if (/[;:]/.test(m.framework_name)) errors.framework_name = 'The name cannot contain a colon or a semicolon.';
  else if (m.framework_name.length > 120) errors.framework_name = 'Keep the name under 120 characters.';
  if (m.reference.includes(';')) errors.reference = 'The reference cannot contain a semicolon. Add a separate mapping for each reference.';
  else if (m.reference.length > 200) errors.reference = 'Keep the reference under 200 characters.';
  return Object.keys(errors).length ? errors : null;
}

/** Names the parser should recognize: the configurable list, then every name already in use. */
export async function knownNames(ctx: ModuleContext): Promise<string[]> {
  const listed = (await ctx.lookups.values(NAMES_LIST)).map((v) => v.label);
  const used = (await ctx.db.query<{ framework_name: string }>('select distinct framework_name from outcome_mappings')).map((r) => r.framework_name);
  const seen = new Set<string>();
  return [...listed, ...used].map(tidy).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/** Rewrites an outcome's "also satisfies" text from its mapping rows. Returns the text before and after. */
export async function textFromRows(ctx: ModuleContext, outcomeId: string, userId: string | null): Promise<{ before: string | null; after: string | null }> {
  const rows = await ctx.db.query<MappingPair>('select framework_name, reference from outcome_mappings where outcome_id = $1', [outcomeId]);
  const before = (await ctx.db.one<{ also_satisfies: string | null }>('select also_satisfies from framework_outcomes where id = $1', [outcomeId]))?.also_satisfies ?? null;
  const after = composeMappings(rows);
  if (before !== after) {
    await ctx.db.query('update framework_outcomes set also_satisfies = $2, updated_at = now(), updated_by = coalesce($3, updated_by) where id = $1', [outcomeId, after, userId]);
  }
  return { before, after };
}

/** Makes the mapping rows match an outcome's "also satisfies" text. Returns what was added and removed. */
export async function rowsFromText(ctx: ModuleContext, outcomeId: string, text: string | null, userId: string | null): Promise<{ added: MappingPair[]; removed: MappingPair[] }> {
  const wanted = parseMappings(text ?? '', await knownNames(ctx)).filter((m) => !mappingProblem(m));
  const have = await ctx.db.query<MappingPair & { id: string }>('select id, framework_name, reference from outcome_mappings where outcome_id = $1', [outcomeId]);
  const wantedKeys = new Set(wanted.map(pairKey));
  const haveKeys = new Set(have.map(pairKey));
  const removed = have.filter((m) => !wantedKeys.has(pairKey(m)));
  const added = wanted.filter((m) => !haveKeys.has(pairKey(m)));
  for (const m of removed) await ctx.db.query('delete from outcome_mappings where id = $1', [m.id]);
  for (const m of added) {
    await ctx.db.query(
      'insert into outcome_mappings (outcome_id, framework_name, reference, created_by) values ($1,$2,$3,$4) on conflict do nothing',
      [outcomeId, m.framework_name, m.reference, userId]);
  }
  return { added, removed: removed.map(({ framework_name, reference }) => ({ framework_name, reference })) };
}
