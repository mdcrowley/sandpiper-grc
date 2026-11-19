import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db.ts';
import type { NewCredential } from './ceremony.ts';

/** How long a ceremony may take from options to answer. Browsers time out at about the same. */
export const CHALLENGE_SECONDS = 300;

const hashChallenge = (challenge: string) => createHash('sha256').update(`webauthn:${challenge}`).digest('hex');

export type Purpose = 'register' | 'login';

/** A new random challenge (32 bytes, base64url), stored as a hash with its purpose and expiry. */
export async function issueChallenge(db: Queryable, purpose: Purpose, userId: string | null): Promise<string> {
  const challenge = randomBytes(32).toString('base64url');
  await db.query('delete from webauthn_challenges where expires_at < now()');
  await db.query(
    `insert into webauthn_challenges (challenge_hash, purpose, user_id, expires_at)
     values ($1, $2, $3, now() + make_interval(secs => $4::int))`,
    [hashChallenge(challenge), purpose, userId, CHALLENGE_SECONDS],
  );
  return challenge;
}

/**
 * Uses up the challenge the client data names. Returns what it was issued for, or null when it is
 * unknown, already used, expired or for another purpose. Deleting it first means it works once only.
 */
export async function consumeChallenge(db: Queryable, challenge: string, purpose: Purpose): Promise<{ userId: string | null } | null> {
  if (typeof challenge !== 'string' || challenge.length > 200) return null;
  const row = await db.one<{ user_id: string | null; purpose: string; live: boolean }>(
    'delete from webauthn_challenges where challenge_hash = $1 returning user_id, purpose, expires_at > now() as live',
    [hashChallenge(challenge)],
  );
  if (!row || !row.live || row.purpose !== purpose) return null;
  return { userId: row.user_id };
}

export interface CredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  alg: number;
  sign_count: number;
  rp_id: string;
  name: string;
  transports: string[];
  aaguid: string | null;
  attestation_format: string | null;
  user_verified: boolean;
  backup_eligible: boolean;
  created_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
}

/** What the API shows about a credential: never the public key or the full credential ID. */
export function publicView(c: CredentialRow) {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
    lastUsedAt: c.last_used_at,
    lastUsedIp: c.last_used_ip,
    synced: c.backup_eligible,
    userVerified: c.user_verified,
    transports: c.transports,
    algorithm: ({ [-7]: 'ES256', [-257]: 'RS256', [-8]: 'EdDSA' } as Record<number, string>)[c.alg] ?? String(c.alg),
    rpId: c.rp_id,
  };
}

export const activeCredentials = (db: Queryable, userId: string) =>
  db.query<CredentialRow>(
    'select * from webauthn_credentials where user_id = $1 and revoked_at is null order by created_at', [userId],
  );

export const findCredential = (db: Queryable, credentialId: string) =>
  db.one<CredentialRow>('select * from webauthn_credentials where credential_id = $1', [credentialId]);

/** True when the person has at least one passkey or security key that has not been removed. */
export async function hasActivePasskey(db: Queryable, userId: string): Promise<boolean> {
  return Boolean(await db.one('select 1 from webauthn_credentials where user_id = $1 and revoked_at is null limit 1', [userId]));
}

export async function saveCredential(
  db: Queryable, userId: string, rpId: string, name: string, transports: string[], c: NewCredential,
): Promise<CredentialRow> {
  return (await db.one<CredentialRow>(
    `insert into webauthn_credentials (user_id, credential_id, public_key, alg, sign_count, rp_id, name, transports,
       aaguid, attestation_format, user_verified, backup_eligible)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) returning *`,
    [userId, c.credentialId, c.publicKey, c.alg, c.signCount, rpId, name, JSON.stringify(transports),
      c.aaguid, c.attestationFormat, c.userVerified, c.backupEligible],
  ))!;
}

/**
 * Records a successful use. The counter is moved only forwards, in the same statement, so two
 * simultaneous uses of one assertion cannot both pass with the same count.
 */
export async function recordUse(db: Queryable, id: string, signCount: number, ip: string | null): Promise<boolean> {
  const row = await db.one(
    `update webauthn_credentials set sign_count = $2, last_used_at = now(), last_used_ip = $3
     where id = $1 and revoked_at is null and (sign_count < $2 or ($2 = 0 and sign_count = 0)) returning id`,
    [id, signCount, ip],
  );
  return Boolean(row);
}

/** Removes every passkey of a person (an administrator's second-factor reset). Returns how many. */
export async function revokeAllPasskeys(db: Queryable, userId: string, by: string | null): Promise<number> {
  const rows = await db.query(
    'update webauthn_credentials set revoked_at = now(), revoked_by = $2 where user_id = $1 and revoked_at is null returning id',
    [userId, by],
  );
  return rows.length;
}

/** Cleans a name typed by a person: one line, at most 60 characters. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
