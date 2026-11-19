import type { ModuleContext, Row } from '../../core/module.ts';

export const COLORS = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'];
export const DEFAULT_STATUS = 'not_evidenced';

/** Inserts or updates functions and their categories for one framework. */
export async function saveStructure(ctx: ModuleContext, frameworkId: string, functions: Row[]): Promise<void> {
  for (const [i, f] of functions.entries()) {
    const code = String(f.code).trim();
    await ctx.db.query(
      `insert into framework_functions (framework_id, code, name, description, color, sort) values ($1,$2,$3,$4,$5,$6)
       on conflict (framework_id, code) do update set name = excluded.name, description = excluded.description,
         color = excluded.color, sort = excluded.sort`,
      [frameworkId, code, String(f.name).trim(), f.description ?? null, COLORS.includes(f.color) ? f.color : 'gray', Number(f.sort) || (i + 1) * 10],
    );
    for (const [j, c] of (Array.isArray(f.categories) ? (f.categories as Row[]) : []).entries()) {
      await ctx.db.query(
        `insert into framework_categories (framework_id, function_code, code, name, description, sort) values ($1,$2,$3,$4,$5,$6)
         on conflict (framework_id, code) do update set function_code = excluded.function_code, name = excluded.name,
           description = excluded.description, sort = excluded.sort`,
        [frameworkId, code, String(c.code).trim(), String(c.name).trim(), c.description ?? null, Number(c.sort) || (i + 1) * 1000 + (j + 1) * 10],
      );
    }
  }
}
