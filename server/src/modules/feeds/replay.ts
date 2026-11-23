// Replay memory for the work-tracker bridge's signed status updates (W17-8).
//
// A signed update carries its time and is refused more than WINDOW_MS away from now, so a copy can
// only be replayed inside that window. Every accepted signature is therefore remembered for the
// whole window (kept twice as long, to allow for clocks a little apart) and never pushed out by
// newer ones: memory that could be evicted by a flood of fresh updates would let an old copy back
// in. Memory stays bounded because a connection that has accepted `max` updates inside the window
// takes no more until older ones have aged out ("full"): the sender retries, nothing is replayed.
import { createHmac } from 'node:crypto';
import type { Queryable } from '../../core/db.ts';

/** How far a status update's timestamp may be from now. */
export const REPLAY_WINDOW_MS = 5 * 60_000;
/** Accepted updates one connection may have inside the window; past it, updates wait. */
export const REPLAY_MAX = 10_000;

export type ReplayAnswer = 'fresh' | 'seen' | 'full';

/** What is stored for a signature: a keyed digest, so the table never holds a usable signature. */
export const signatureDigest = (signature: string) => createHmac('sha256', 'seen').update(signature).digest('hex');

/**
 * Remembers an accepted signature for a connection. 'fresh': first time, now remembered; 'seen': a
 * copy of one already accepted inside the window (refuse it); 'full': the connection has accepted
 * `max` updates inside the window (refuse for now; nothing is forgotten to make room).
 */
export async function rememberSignature(
  db: Queryable, connectorId: string, signature: string, opts: { windowMs?: number; max?: number } = {},
): Promise<ReplayAnswer> {
  const windowMs = opts.windowMs ?? REPLAY_WINDOW_MS;
  const max = opts.max ?? REPLAY_MAX;
  const digest = signatureDigest(signature);
  // Only what has aged out of the window (twice over) is forgotten.
  await db.query(
    `delete from ticket_inbound_signatures where connector_id = $1 and seen_at < now() - make_interval(secs => $2::double precision)`,
    [connectorId, (2 * windowMs) / 1000]);
  if (await db.one('select 1 from ticket_inbound_signatures where connector_id = $1 and signature = $2', [connectorId, digest])) return 'seen';
  const held = (await db.one<{ n: number }>('select count(*)::int as n from ticket_inbound_signatures where connector_id = $1', [connectorId]))!.n;
  if (held >= max) return 'full';
  const fresh = await db.one(
    'insert into ticket_inbound_signatures (connector_id, signature) values ($1, $2) on conflict do nothing returning signature',
    [connectorId, digest]);
  return fresh ? 'fresh' : 'seen';
}
