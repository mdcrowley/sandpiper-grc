// Invented sample data for the dev profile: an evidence link on the first sample control (E36-05) and
// a work-tracker connection that is switched off (E36-06). Calendar feeds stay off and none is made: a
// feed's address is a secret shown once, so a sample one would be of no use. Idempotent.
import { randomBytes, randomUUID } from 'node:crypto';
import { secretBox } from '../../core/auth.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

const SAMPLE_LINK = 'https://documents.example.test/compliance/control-tests/remote-access-review.pdf';
const SAMPLE_CONNECTOR = 'Work tracker (sample)';

export async function seedFeeds(ctx: ModuleContext, opts: { profile: string }): Promise<string | null> {
  if (opts.profile !== 'dev') return null;
  const done: string[] = [];
  const control = ctx.resources.get('control')
    ? await ctx.db.one<Row>('select id from controls where deleted_at is null order by ref nulls last, created_at limit 1')
    : undefined;
  if (control && !(await ctx.db.one('select 1 from attachments where link_url = $1', [SAMPLE_LINK]))) {
    await ctx.db.query(
      `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256, storage_driver, storage_key,
         kind, description, collected_on, scan_status, uploaded_by_name, link_url, link_title, last_checked_on)
       values ('control', $1, $2, '', 'text/uri-list', 0, '', 'link', $3, 'evidence', $4, $5, 'not_applicable', 'Sample data', $6, $2, $7)`,
      [control.id, 'Remote-access review record (sample)', `link/${randomUUID()}`, 'Kept in the document store; linked, not copied (sample).',
        dayInZone(-100), SAMPLE_LINK, dayInZone(-100)]);
    done.push('1 evidence link, due for a check');
  }
  // The sample's first name, from before the bridge was called a work tracker.
  await ctx.db.query(`update ticket_connectors set name = $1, url_host = 'tracker.example.test' where name = 'Service desk tool (sample)'`, [SAMPLE_CONNECTOR]);
  if (!(await ctx.db.one('select 1 from ticket_connectors where name = $1', [SAMPLE_CONNECTOR]))) {
    const row = (await ctx.db.one<Row>(
      `insert into ticket_connectors (name, url_sealed, url_host, secret_sealed, inbound_secret_sealed, active, record_types, status_map)
       values ($1, '', 'tracker.example.test', '', '', false, '["action", "vulnerability"]'::jsonb, $2::jsonb) returning id`,
      [SAMPLE_CONNECTOR, JSON.stringify({ action: { Resolved: 'done', 'In progress': 'in_progress' }, vulnerability: { Resolved: 'fixed' } })]))!;
    const box = secretBox(ctx.db);
    await ctx.db.query('update ticket_connectors set url_sealed = $2, secret_sealed = $3, inbound_secret_sealed = $4 where id = $1', [
      row.id, box.encrypt('https://tracker.example.test/hooks/grc', `ticket-connector-url:${row.id}`),
      box.encrypt(randomBytes(32).toString('base64url'), `ticket-connector-secret:${row.id}`),
      box.encrypt(randomBytes(32).toString('base64url'), `ticket-connector-inbound:${row.id}`)]);
    done.push('1 work-tracker connection (switched off)');
  }
  return done.length ? done.join(', ') : 'sample data already there';
}
