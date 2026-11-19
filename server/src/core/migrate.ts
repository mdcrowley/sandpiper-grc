import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';

export interface MigrationSource {
  /** Prefix recorded in schema_migrations, e.g. "core" or a module key. */
  scope: string;
  dir: string;
}

export async function migrate(db: Db, sources: MigrationSource[]): Promise<string[]> {
  await db.exec(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const { scope, dir } of sources) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const name = `${scope}/${file}`;
      if (done.has(name)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      try {
        await db.tx(async (tx) => {
          await tx.exec(sql);
          await tx.query('insert into schema_migrations (name) values ($1)', [name]);
        });
      } catch (err) {
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
      applied.push(name);
    }
  }
  return applied;
}
