import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail } from './errors.ts';
import type { Row } from './module.ts';

/**
 * Per-user preferences (E01-24): small JSON values kept on the server so saved views, column
 * choices and overview widgets follow a person from one browser to another.
 *
 * A person reads and writes only their own. Writes are not audited: like the read state of a
 * notification, these are personal view settings, not records.
 */
export const PREFERENCE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
export const PREFERENCE_MAX_BYTES = 32 * 1024;
export const PREFERENCE_MAX_KEYS = 300;

export function registerPreferences(app: FastifyInstance, db: Db) {
  const keyOf = (req: FastifyRequest) => {
    const key = String((req.params as Row).key ?? '');
    if (!PREFERENCE_KEY_RE.test(key)) fail(400, 'bad_key', 'Preference keys use letters, numbers, dots, dashes and colons (at most 120).');
    return key;
  };

  // Every preference of the signed-in person: { <key>: value }. `prefix=` narrows it.
  app.get('/api/me/preferences', async (req) => {
    const prefix = String((req.query as Row).prefix ?? '');
    const rows = await db.query<{ key: string; value: unknown }>(
      'select key, value from user_preferences where user_id = $1 and left(key, length($2)) = $2 order by key', [req.user!.id, prefix]);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  // One preference. A key that was never set answers { key, value: null } (not a 404), so a page
  // can ask for its settings without treating "none yet" as an error.
  app.get('/api/me/preferences/:key', async (req) => {
    const key = keyOf(req);
    const row = await db.one<{ value: unknown; updated_at: string }>(
      'select value, updated_at from user_preferences where user_id = $1 and key = $2', [req.user!.id, key]);
    return { key, value: row?.value ?? null, updatedAt: row?.updated_at ?? null };
  });

  // Body: { value: <any JSON> }. A null value removes the preference.
  app.put('/api/me/preferences/:key', async (req) => {
    const key = keyOf(req);
    const b = (req.body ?? {}) as Row;
    if (!('value' in b)) fail(400, 'validation', 'Send { "value": ... }.');
    if (b.value === null) {
      await db.query('delete from user_preferences where user_id = $1 and key = $2', [req.user!.id, key]);
      return { key, value: null, updatedAt: null };
    }
    const json = JSON.stringify(b.value);
    if (Buffer.byteLength(json, 'utf8') > PREFERENCE_MAX_BYTES) {
      fail(413, 'too_large', `A preference may hold at most ${PREFERENCE_MAX_BYTES / 1024} KB.`);
    }
    const count = await db.one<{ c: number }>('select count(*)::int c from user_preferences where user_id = $1 and key <> $2', [req.user!.id, key]);
    if (count!.c >= PREFERENCE_MAX_KEYS) fail(409, 'too_many', `You can keep at most ${PREFERENCE_MAX_KEYS} preferences. Remove one first.`);
    const row = await db.one<{ updated_at: string }>(
      `insert into user_preferences (user_id, key, value) values ($1, $2, $3::jsonb)
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now() returning updated_at`,
      [req.user!.id, key, json]);
    return { key, value: b.value, updatedAt: row!.updated_at };
  });

  app.delete('/api/me/preferences/:key', async (req) => {
    await db.query('delete from user_preferences where user_id = $1 and key = $2', [req.user!.id, keyOf(req)]);
    return { ok: true };
  });
}
