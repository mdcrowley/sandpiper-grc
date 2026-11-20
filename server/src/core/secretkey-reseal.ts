import type { Queryable } from './db.ts';
import { isEncrypted, type SecretBox } from './secretbox.ts';

/**
 * Every value in the database that is sealed with the secret box (E02-20), so that after a key
 * change ALL of them are re-encrypted with the current key at start-up, not only authenticator
 * keys. Once nothing is left on a retired key, the retired keys (GRC_SECRET_KEY_PREVIOUS,
 * <key file>.previous) can be deleted; `secret-key show` says whether that point has been reached.
 *
 * A kind of value names where it lives and the context it was sealed with (secretbox.ts binds
 * each value to its context, so a value copied onto another row does not open). A table that does
 * not exist in this installation (its module is not loaded) is skipped.
 *
 * Adding a new sealed value anywhere? Add it here, with a test in secretkey-reseal.test.ts.
 */
export interface SealedValue { id: string; stored: string; context: string }

export interface SealedKind {
  key: string;
  /** Plain words for messages: "authenticator keys". */
  label: string;
  /** Table that must exist for this kind to be looked at. */
  table: string;
  list(db: Queryable): Promise<SealedValue[]>;
  /** Replaces one value, only if it is still the one that was read. */
  write(db: Queryable, v: SealedValue, sealed: string): Promise<void>;
}

const column = (
  key: string, label: string, table: string, idCol: string, col: string, context: (id: string) => string,
  extraWhere = '',
): SealedKind => ({
  key, label, table,
  async list(db) {
    const rows = await db.query<{ id: string; v: string }>(
      `select ${idCol}::text as id, ${col} as v from ${table} where ${col} is not null and ${col} <> ''${extraWhere ? ` and ${extraWhere}` : ''}`,
    );
    return rows.map((r) => ({ id: r.id, stored: r.v, context: context(r.id) }));
  },
  async write(db, v, sealed) {
    await db.query(`update ${table} set ${col} = $2 where ${idCol}::text = $1 and ${col} = $3`, [v.id, sealed, v.stored]);
  },
});

export const SEALED_KINDS: SealedKind[] = [
  column('totp', 'authenticator keys', 'users', 'id', 'totp_secret', (id) => `totp:${id}`),
  column('webhook', 'webhook signing secrets', 'webhooks', 'id', 'secret', (id) => `webhook:${id}`),
  // Client secrets (OpenID Connect), this application's SAML keys and directory (LDAP) service account passwords (E02-26).
  column('idp', 'sign-in provider secrets (client secrets, SAML keys, directory service account passwords)', 'identity_providers', 'id', 'secret', (id) => `idp:${id}`),
  column('sso_flow', 'single sign-on requests in progress', 'identity_flows', 'state_hash', 'remember', (id) => `sso:${id}`, 'expires_at > now()'),
  column('sso_post', 'SAML responses waiting for their browser', 'identity_flows', 'state_hash', 'posted', (id) => `sso-post:${id}`, 'expires_at > now()'),
  column('sso_session', 'provider sign-out details of open sessions', 'identity_sessions', 'token_hash', 'id_token_sealed', (id) => `sso-session:${id}`),
  column('mail', 'the mail server password', 'mail_config', 'id', 'password_sealed', () => 'mail:smtp'),
  {
    key: 'mail_providers', label: 'Microsoft Graph and Gmail API credentials, and the text-message webhook secret', table: 'mail_config',
    async list(db) {
      if (!(await columnExists(db, 'mail_config', 'provider_secrets'))) return [];
      const rows = await db.query<{ k: string; v: string }>(`select e.key as k, e.value as v from mail_config, jsonb_each_text(provider_secrets) e where id = 1`);
      return rows.filter((r) => r.v).map((r) => ({ id: r.k, stored: r.v, context: `mail:${r.k}` }));
    },
    async write(db, v, sealed) {
      await db.query(`update mail_config set provider_secrets = jsonb_set(provider_secrets, array[$1::text], to_jsonb($2::text)) where id = 1 and provider_secrets->>$1 = $3`, [v.id, sealed, v.stored]);
    },
  },
  {
    key: 'email_intake', label: 'the email-to-ticket mailbox password', table: 'settings',
    async list(db) {
      const row = await db.one<{ v: string | null }>(`select value->>'password_sealed' as v from settings where key = 'tickets.email_intake'`);
      return row?.v ? [{ id: 'tickets.email_intake', stored: row.v, context: 'tickets:email_intake' }] : [];
    },
    async write(db, v, sealed) {
      await db.query(
        `update settings set value = jsonb_set(value, '{password_sealed}', to_jsonb($2::text)) where key = $1 and value->>'password_sealed' = $3`,
        [v.id, sealed, v.stored],
      );
    },
  },
  {
    key: 'mail_link', label: 'set-up and reset links waiting to be emailed', table: 'jobs',
    async list(db) {
      const rows = await db.query<{ id: string; v: string; log: string }>(
        `select id::text as id, payload->>'sealedLink' as v, payload->>'logId' as log from jobs
         where type = 'mail.send' and status in ('queued', 'failed', 'running') and payload ? 'sealedLink'`,
      );
      return rows.filter((r) => r.v && r.log).map((r) => ({ id: r.id, stored: r.v, context: `mail:link:${r.log}` }));
    },
    async write(db, v, sealed) {
      await db.query(
        `update jobs set payload = jsonb_set(payload, '{sealedLink}', to_jsonb($2::text)) where id::text = $1 and payload->>'sealedLink' = $3`,
        [v.id, sealed, v.stored],
      );
    },
  },
  {
    key: 's3', label: 'the object store secret key', table: 'settings',
    async list(db) {
      const row = await db.one<{ v: string | null }>(`select value->'s3'->>'secret' as v from settings where key = 'attachments.storage'`);
      return row?.v ? [{ id: 'attachments.storage', stored: row.v, context: 'attachments.s3.secret' }] : [];
    },
    async write(db, v, sealed) {
      await db.query(
        `update settings set value = jsonb_set(value, '{s3,secret}', to_jsonb($2::text)) where key = $1 and value->'s3'->>'secret' = $3`,
        [v.id, sealed, v.stored],
      );
    },
  },
];

export interface ResealCount { key: string; label: string; total: number; current: number; changed: number; unreadable: number }

async function tableExists(db: Queryable, table: string): Promise<boolean> {
  return Boolean((await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`]))?.t);
}

async function columnExists(db: Queryable, table: string, col: string): Promise<boolean> {
  return Boolean(await db.one(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, col],
  ));
}

/**
 * Looks at every sealed value. With `write`, re-encrypts with the current key each value that was
 * written with a retired key, or left in the clear by an older version. Without it, only counts:
 * `changed` is then "would be re-encrypted". Never prints or returns a value.
 */
export async function resealStoredSecrets(db: Queryable, box: SecretBox, opts: { write: boolean; kinds?: SealedKind[] }): Promise<ResealCount[]> {
  const out: ResealCount[] = [];
  for (const kind of opts.kinds ?? SEALED_KINDS) {
    if (!(await tableExists(db, kind.table))) continue;
    if (kind.key === 'sso_session' && !(await columnExists(db, 'identity_sessions', 'id_token_sealed'))) continue;
    if (kind.key === 'sso_post' && !(await columnExists(db, 'identity_flows', 'posted'))) continue;
    const count: ResealCount = { key: kind.key, label: kind.label, total: 0, current: 0, changed: 0, unreadable: 0 };
    for (const v of await kind.list(db)) {
      count.total += 1;
      if (isEncrypted(v.stored) && box.isCurrent(v.stored, v.context)) { count.current += 1; continue; }
      let plain: string;
      try {
        plain = box.decrypt(v.stored, v.context);
      } catch {
        count.unreadable += 1; // written with a key that is not supplied: left as it is, and reported
        continue;
      }
      if (opts.write) await kind.write(db, v, box.encrypt(plain, v.context));
      count.changed += 1;
    }
    out.push(count);
  }
  return out;
}

/** One line for `secret-key show` and the start-up log: are the retired keys still needed? */
export function retiredKeyAdvice(counts: ResealCount[], retiredKeys: number): string {
  const waiting = counts.reduce((n, c) => n + c.changed, 0);
  const unreadable = counts.filter((c) => c.unreadable);
  const parts: string[] = [];
  if (waiting) {
    parts.push(`${waiting} stored value(s) still use a retired key (${counts.filter((c) => c.changed).map((c) => `${c.changed} ${c.label}`).join(', ')}): `
      + 'keep the retired keys until the server has been started once, which re-encrypts them.');
  } else if (retiredKeys) {
    parts.push('Every stored value uses the current key: the retired keys are no longer needed and can be deleted.');
  } else {
    parts.push('Every stored value uses the current key.');
  }
  if (unreadable.length) {
    parts.push(`${unreadable.reduce((n, c) => n + c.unreadable, 0)} value(s) cannot be read with any key supplied (${unreadable.map((c) => `${c.unreadable} ${c.label}`).join(', ')}). `
      + 'Supply the key they were written with (GRC_SECRET_KEY_PREVIOUS), or enter those secrets again.');
  }
  return parts.join(' ');
}
