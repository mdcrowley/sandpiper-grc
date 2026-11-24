// Sample data is marked one way (E18-65): "[Sample] X" at the start of a name. Earlier versions of
// some seeds marked it "X (sample)" at the end. Each of those seeds calls `renameSamples` first, so a
// database loaded before the change has its old sample records renamed in place (with an audit event
// where the table is a record type) instead of getting a second copy under the new name. Cheap when
// nothing matches; safe to run on every seed. Reached only from `npm run seed -- --profile dev` (every
// caller returns before it for other profiles; seeds run only from the command line, server stopped).
//
// When a record's own rules refuse the rename (closed, approved), the row is renamed directly and the
// audit event says so (W19). A record under an active legal hold is never renamed that way: it keeps its
// old name, and the seed says so on the console.
import { holdsOn } from '../../core/holds.ts';
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
          let why = '';
          try {
            await ctx.resources.update(r.type!, id, { [column]: to });
            renamed++;
            continue;
          } catch (err) {
            // A record its own rules keep from being edited (closed, approved): renamed directly, and audited here.
            why = String((err as Error)?.message ?? err).slice(0, 160);
          }
          // W19: never past a legal hold, even for sample data.
          if ((await holdsOn(ctx.db, r.type!, id)).length) {
            console.warn(`[seed] sample ${r.type} "${from}" is under a legal hold, so it keeps its old name`);
            continue;
          }
          await ctx.db.query(`update ${table} set ${column} = $2 where id = $1`, [id, to]);
          await ctx.audit(null, {
            action: `${r.type}.update`, recordType: r.type, recordId: id,
            summary: `Sample renamed directly by the dev seed, past the record's own rules (${why || 'refused'}): ${from} to ${to}`,
            before: { [column]: from }, after: { [column]: to },
          });
        } else {
          await ctx.db.query(`update ${table} set ${column} = $2 where id = $1`, [id, to]);
        }
        renamed++;
      }
    }
  }
  return renamed;
}
