// Sample legal hold (dev profile only, invented): one active hold for an invented claim, holding two
// sample safety events by hand and the sample security incident by a saved query. Modules seed in key
// order and `holds` comes before `safety` and `secincidents`, so the records are placed by the job
// `holds.sample` once the server starts (and at once when the samples already exist, on a re-seed).
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { renameSamples, type SampleRename } from '../inventory/seed-rename.ts';
import { addRecords, HOLD_TYPE, runQuery } from './service.ts';

export const SAMPLE_MATTER = '[Sample] Platform incident claim';
const SAMPLE_COUNSEL = '[Sample] Outside counsel';
export const SAMPLE_JOB = 'holds.sample';

/** Places the sample records on the sample hold. Idempotent; does nothing until the samples exist. */
export async function placeSampleRecords(ctx: ModuleContext): Promise<{ events: number; incident: number }> {
  const hold = await ctx.db.one<Row>(`select id, status from legal_holds where matter = $1 and deleted_at is null`, [SAMPLE_MATTER]);
  if (!hold || hold.status !== 'active') return { events: 0, incident: 0 };
  let events = 0;
  if (ctx.resources.get('safety_event')) {
    const already = (await ctx.db.one<{ n: number }>(
      `select count(*)::int n from legal_hold_records where hold_id = $1 and record_type = 'safety_event' and query_id is null`, [hold.id]))!.n;
    if (!already) {
      const picked = await ctx.db.query<{ id: string }>(
        `select id from safety_events where deleted_at is null and event_type in ('passenger_injury', 'slip_trip_fall')
         order by occurred_at desc limit 2`);
      events = await addRecords(ctx, hold.id, picked.map((p) => ({ type: 'safety_event', id: p.id })), null);
    }
  }
  let incident = 0;
  for (const q of await ctx.db.query<Row>('select * from legal_hold_queries where hold_id = $1', [hold.id])) {
    incident += (await runQuery(ctx, q, null)).added;
  }
  return { events, incident };
}

/** Names of an earlier version, renamed in place (E18-65). */
export const HOLDS_RENAMES: SampleRename[] = [
  { type: HOLD_TYPE, column: 'matter', names: [['Sample matter: platform incident claim (sample)', SAMPLE_MATTER]] },
  { type: HOLD_TYPE, column: 'counsel_name', every: true, names: [['Sample outside counsel (sample)', SAMPLE_COUNSEL]] },
];

export async function seedHolds(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (the sample legal hold is dev profile only)';
  await renameSamples(ctx, HOLDS_RENAMES);
  let hold = await ctx.db.one<Row>(`select id from legal_holds where matter = $1 and deleted_at is null`, [SAMPLE_MATTER]);
  if (!hold) {
    hold = await ctx.resources.create(HOLD_TYPE, {
      matter: SAMPLE_MATTER,
      description: 'Invented sample. Keep everything about a passenger\'s fall on a platform, and the related tabletop incident, until counsel says the claim is settled.',
      counsel_name: SAMPLE_COUNSEL,
      starts_on: dayInZone(-30),
    });
    await ctx.db.query(
      `insert into legal_hold_queries (hold_id, record_type, q, filters) values ($1, 'security_incident', '[Sample]', '{}'::jsonb)`, [hold!.id]);
  }
  const placed = await placeSampleRecords(ctx);
  if (ctx.app.hasDecorator('jobs')) await ctx.app.jobs.enqueue(SAMPLE_JOB, {}, { key: SAMPLE_JOB });
  return `sample legal hold ready (${placed.events} safety events and ${placed.incident} incident placed now; the rest when the server starts)`;
}
