import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { rememberSignature, signatureDigest } from './replay.ts';

// W17-8: the work-tracker replay memory is bounded, but nothing inside the time window is ever
// forgotten to make room: a connection that is full refuses new updates until old ones age out.

let t: Awaited<ReturnType<typeof testApp>>;
let connector = '';

beforeAll(async () => {
  process.env.GRC_MODULES = 'feeds,attachments,notifications,admin';
  t = await testApp();
  connector = (await t.db.one<{ id: string }>(
    `insert into ticket_connectors (name, url_sealed, url_host, secret_sealed, inbound_secret_sealed)
     values ('Replay sample', 'x', 'tracker.example.test', 'x', 'x') returning id`))!.id;
});
afterAll(async () => { await t?.close(); });

describe('work-tracker replay memory (W17-8)', () => {
  it('accepts a signature once and refuses its copy, storing only a digest', async () => {
    expect(await rememberSignature(t.db, connector, 'sha256=aaa')).toBe('fresh');
    expect(await rememberSignature(t.db, connector, 'sha256=aaa')).toBe('seen');
    const stored = await t.db.query<{ signature: string }>('select signature from ticket_inbound_signatures where connector_id = $1', [connector]);
    expect(stored.map((r) => r.signature)).toEqual([signatureDigest('sha256=aaa')]);
  });

  it('when full, refuses new updates instead of forgetting one still inside the window', async () => {
    const opts = { max: 3 };
    expect(await rememberSignature(t.db, connector, 'sha256=bbb', opts)).toBe('fresh');
    expect(await rememberSignature(t.db, connector, 'sha256=ccc', opts)).toBe('fresh');
    expect(await rememberSignature(t.db, connector, 'sha256=ddd', opts)).toBe('full');
    // The first one is still remembered: its copy is refused, not let in again.
    expect(await rememberSignature(t.db, connector, 'sha256=aaa', opts)).toBe('seen');
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from ticket_inbound_signatures where connector_id = $1', [connector]))!.n).toBe(3);
  });

  it('forgets only what has aged out of the window, which makes room again', async () => {
    await t.db.query(`update ticket_inbound_signatures set seen_at = now() - interval '11 minutes' where connector_id = $1 and signature = $2`, [connector, signatureDigest('sha256=aaa')]);
    expect(await rememberSignature(t.db, connector, 'sha256=ddd', { max: 3 })).toBe('fresh');
    expect((await t.db.query('select 1 from ticket_inbound_signatures where connector_id = $1 and signature = $2', [connector, signatureDigest('sha256=aaa')])).length).toBe(0);
    expect(await rememberSignature(t.db, connector, 'sha256=bbb', { max: 3 })).toBe('seen');
  });
});
