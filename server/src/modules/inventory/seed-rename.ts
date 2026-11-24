// Sample data is marked one way (E18-65): "[Sample] X" at the start of a name. Earlier versions of
// some seeds marked it "X (sample)" at the end. Each of those seeds calls `renameSamples` first, so a
// database loaded before the change has its old sample records renamed in place (with an audit event
// where the table is a record type) instead of getting a second copy under the new name. Cheap when
// nothing matches; safe to run on every seed.
import type { ModuleContext, Row } from '../../core/module.ts';

export const SAMPLE_PREFIX = '[Sample] ';

/** The old name of a sample: "[Sample] X" was "X (sample)". */
export function oldSampleName(name: string): string {
  return name.startsWith(SAMPLE_PREFIX) ? `${name.slice(SAMPLE_PREFIX.length)} (sample)` : name;
}

export interface SampleRename {
  /** A record type: rows are renamed through ctx.resources.update, so an audit event is written. */
  type?: string;
  /** The table; taken from the record type when one is given. */
  table?: string;
  /** The column holding the name (default `name`). */
  column?: string;
  /**
   * Every row holding the old value is renamed (people's names typed into records, such as an
   * approver). Without it the column names one record: a row is renamed only while no live row has
   * the new name yet.
   */
  every?: boolean;
  /** New names ("[Sample] X", the old one being "X (sample)"), or explicit [old, new] pairs. */
  names: (string | [string, string])[];
}

/** [old, new] pairs of one rename. */
export function renamePairs(r: SampleRename): [string, string][] {
  return r.names.map((n) => (typeof n === 'string' ? [oldSampleName(n), n] : n));
}

const softDelete = new WeakMap<object, Map<string, boolean>>();
async function hasDeletedAt(ctx: ModuleContext, table: string): Promise<boolean> {
  let known = softDelete.get(ctx.db);
  if (!known) softDelete.set(ctx.db, known = new Map());
  if (!known.has(table)) {
    known.set(table, !!(await ctx.db.one(
      `select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'deleted_at'`, [table])));
  }
  return known.get(table)!;
}

/** Renames old "X (sample)" records to "[Sample] X". Returns how many rows were renamed. */
export async function renameSamples(ctx: ModuleContext, renames: SampleRename[]): Promise<number> {
  let renamed = 0;
  for (const r of renames) {
    const def = r.type ? ctx.resources.get(r.type) : undefined;
    const table = r.table ?? def?.table;
    if (!table) continue; // the record type is not loaded: nothing of it to rename
    const column = r.column ?? 'name';
    const live = (await hasDeletedAt(ctx, table)) ? ' and deleted_at is null' : '';
    for (const [from, to] of renamePairs(r)) {
      const rows = await ctx.db.query<Row>(`select id from ${table} where ${column} = $1${live} order by id`, [from]);
      if (!rows.length) continue;
      if (!r.every && await ctx.db.one(`select 1 from ${table} where ${column} = $1${live} limit 1`, [to])) continue;
      for (const { id } of r.every ? rows : rows.slice(0, 1)) {
        if (def) {
          try {
            await ctx.resources.update(r.type!, id, { [column]: to });
            renamed++;
            continue;
          } catch {
            // A record its own rules keep from being edited (closed, approved): renamed directly, and audited here.
          }
          await ctx.db.query(`update ${table} set ${column} = $2 where id = $1`, [id, to]);
          await ctx.audit(null, { action: `${r.type}.update`, recordType: r.type, recordId: id, summary: `Sample renamed: ${from} to ${to}`, before: { [column]: from }, after: { [column]: to } });
        } else {
          await ctx.db.query(`update ${table} set ${column} = $2 where id = $1`, [id, to]);
        }
        renamed++;
      }
    }
  }
  return renamed;
}
