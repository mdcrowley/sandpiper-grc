// Scheduled delivery. A schedule renders a report or dashboard once for each recipient, with that
// recipient's own permissions, stores the result as a snapshot and tells the recipient in the
// application. The job queue runs due schedules (the `reports.deliver` job, see index.ts) and sends
// any email (one `mail.send` job per message); every function here takes the clock as an argument
// so that tests choose the time.
import { TIME_ZONE } from '../../core/config.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { emitWebhookEvent } from '../../core/webhooks.ts';
import type { Documents, BuiltDocument } from './documents.ts';
import { FILE_TYPES, renderFile, type FileKind } from './files.ts';
import { AccessError } from './query.ts';
import type { Snapshots } from './snapshots.ts';
import { SpecError } from './spec.ts';

// ---------- the organization's wall clock ----------

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function zoned(at: Date): { y: number; m: number; d: number; h: number; weekday: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), weekday: WEEKDAYS.indexOf(p.weekday) + 1 };
}

/** The instant at which the organization's clocks read this date and hour. */
export function zonedToUtc(y: number, m: number, d: number, h: number): Date {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 3; i++) {
    const z = zoned(new Date(guess));
    const diff = Date.UTC(y, m - 1, d, h) - Date.UTC(z.y, z.m - 1, z.d, z.h);
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => { const v = Math.round(Number(n)); return Number.isFinite(v) && n !== null && n !== '' ? Math.min(hi, Math.max(lo, v)) : fallback; };

/** The first run time strictly after `after`. Monthly schedules on day 29 to 31 run on the last day of shorter months. */
export function nextRun(s: { cadence: string; hour?: unknown; weekday?: unknown; month_day?: unknown }, after: Date): Date {
  const hour = clamp(s.hour, 0, 23, 7);
  const now = zoned(after);
  const monthLength = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(now.y, now.m - 1, now.d + i));
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const weekday = ((day.getUTCDay() + 6) % 7) + 1;
    const due = s.cadence === 'daily' ? true
      : s.cadence === 'monthly' ? d === Math.min(clamp(s.month_day, 1, 31, 1), monthLength(y, m))
      : weekday === clamp(s.weekday, 1, 7, 1);
    if (!due) continue;
    const at = zonedToUtc(y, m, d, hour);
    if (at.getTime() > after.getTime()) return at;
  }
  return new Date(after.getTime() + 86400000);
}

// ---------- delivery ----------

/** A file that goes with a delivery: the PDF or spreadsheet of a schedule set to one of those formats. */
export interface DeliveryAttachment { filename: string; content: Buffer; contentType: string }

/** How a schedule uses email: not at all, a link to the stored copy (the default), or the file attached. */
export type EmailMode = 'off' | 'link' | 'attach';
export const emailMode = (v: unknown): EmailMode => (v === 'off' || v === 'attach' ? v : 'link');

export interface DeliveryMessage {
  title: string; body: string; route: string;
  email: EmailMode;
  /** The file, when the schedule attaches it and this recipient may take it out of the application. */
  attachment?: DeliveryAttachment;
}
export interface ChannelResult {
  ok: boolean; detail?: string;
  /** An email was queued, and whether it carries the file. */
  emailed?: { attached: boolean };
}

/**
 * How a finished snapshot reaches a person. The in-application notification always runs. Email
 * runs only when the email service is loaded and an administrator has switched it on
 * (`app.sendMail`, which queues one job per message) and the schedule does not say "off". The
 * message names the schedule and links to the stored copy; it never carries the figures in its
 * text. A file is attached only when the schedule asks for it (see `runSchedule` for who gets it).
 */
export interface DeliveryChannel {
  key: string;
  deliver(ctx: ModuleContext, to: SessionUser, message: DeliveryMessage): Promise<ChannelResult>;
}

type SendMail = (mail: {
  userIds: string[]; template: string; purpose: string;
  data: Record<string, string>; attachments?: { filename: string; content: Buffer; contentType: string }[];
}) => Promise<{ queued?: number; enabled?: boolean } | undefined>;

export const channels: DeliveryChannel[] = [{
  key: 'in_app',
  async deliver(ctx, to, message) {
    if (!ctx.app.hasDecorator('notify')) return { ok: true, detail: 'Stored; the notifications module is not loaded, so no notification was raised.' };
    const sent = await (ctx.app as unknown as { notify(input: Row): Promise<{ sent: number }> }).notify({
      userIds: [to.id], kind: 'general', title: message.title, body: message.body, route: message.route,
    });
    return { ok: true, detail: sent.sent ? undefined : 'Stored; the recipient has switched this kind of notification off.' };
  },
}, {
  key: 'email',
  async deliver(ctx, to, message) {
    if (message.email === 'off') return { ok: true };
    const send = ctx.app.hasDecorator('sendMail') ? (ctx.app as unknown as { sendMail?: SendMail }).sendMail : undefined;
    if (typeof send !== 'function') return { ok: true };
    const kind = message.attachment?.contentType === 'application/pdf' ? 'PDF' : message.attachment?.contentType === 'text/csv; charset=utf-8' ? 'CSV file' : 'spreadsheet';
    try {
      // By user id: the mail service looks up the address and checks the person is still active when it sends.
      const sent = await send.call(ctx.app, {
        userIds: [to.id], template: 'message', purpose: 'reports',
        data: {
          subject: message.title,
          message: `${message.body}${message.attachment ? `\n\nThe ${kind} is attached. It holds the figures your role allows; do not pass it on.` : ''}`,
          link: message.route,
        },
        ...(message.attachment ? { attachments: [message.attachment] } : {}),
      });
      // Email switched off, or no usable address: the in-application delivery stands alone.
      if (!sent || sent.enabled === false || !sent.queued) return { ok: true };
      return { ok: true, detail: message.attachment ? `Email with the ${kind} attached is on its way.` : 'Email with a link is on its way.', emailed: { attached: Boolean(message.attachment) } };
    } catch (err) {
      console.error('[reports] scheduled email failed:', err);
      return { ok: false, detail: 'Stored and notified in the application; the email could not be queued.' };
    }
  },
}];

/** Every active user with the permissions their enabled roles grant (as core loads a session user). */
export async function activeUsers(ctx: ModuleContext): Promise<SessionUser[]> {
  const rows = await ctx.db.query<Row>(
    `select u.id, u.username, u.display_name, u.email,
        coalesce(array_agg(distinct r.key) filter (where r.enabled), '{}') as roles,
        coalesce(array_agg(distinct rp.permission) filter (where r.enabled and rp.permission is not null), '{}') as permissions
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     left join role_permissions rp on rp.role_id = r.id
     where u.status = 'active' and u.deleted_at is null
     group by u.id`,
  );
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, roles: r.roles, permissions: r.permissions }));
}

export interface ScheduleDeps {
  documents: Documents; snapshots: Snapshots;
  /** Whether a person may see the report or dashboard (its sharing). Absent: everyone may. */
  canSee?: (user: SessionUser, type: 'report_definition' | 'dashboard', row: Row) => boolean;
}
export interface RunSummary { scheduleId: string; delivered: number; skipped: number; failed: number; snapshots: string[] }

export async function runSchedule(ctx: ModuleContext, deps: ScheduleDeps, s: Row, now: Date): Promise<RunSummary> {
  const out: RunSummary = { scheduleId: s.id, delivered: 0, skipped: 0, failed: 0, snapshots: [] };
  const log = (userId: string | null, status: string, detail: string | null, snapshotId: string | null = null) => ctx.db.query(
    'insert into report_deliveries (schedule_id, user_id, snapshot_id, status, detail, created_at) values ($1,$2,$3,$4,$5,$6)',
    [s.id, userId, snapshotId, status, detail, now.toISOString()],
  );
  const isDash = s.target_type === 'dashboard';
  const target = UUID_RE.test(String(s.target_id))
    ? await ctx.db.one<Row>(`select * from ${isDash ? 'dashboards' : 'report_definitions'} where id = $1 and deleted_at is null`, [s.target_id])
    : undefined;

  if (!target) {
    out.failed = 1;
    await log(null, 'failed', `The ${isDash ? 'dashboard' : 'report'} no longer exists.`);
  } else {
    const users = Array.isArray(s.recipient_users) ? s.recipient_users.map(String) : [];
    const roles = Array.isArray(s.recipient_roles) ? s.recipient_roles.map(String) : [];
    const recipients = (await activeUsers(ctx)).filter((u) => users.includes(u.id) || u.roles.some((r) => roles.includes(r)));
    for (const to of recipients) {
      try {
        if (!ctx.can(to, `${isDash ? 'dashboards' : 'reports'}.view`)) {
          out.skipped += 1;
          await log(to.id, 'skipped', `Their role does not include viewing ${isDash ? 'dashboards' : 'reports'}.`);
          continue;
        }
        if (deps.canSee && !deps.canSee(to, isDash ? 'dashboard' : 'report_definition', target)) {
          out.skipped += 1;
          await log(to.id, 'skipped', `The ${isDash ? 'dashboard' : 'report'} is not shared with them.`);
          continue;
        }
        let doc: BuiltDocument;
        try {
          doc = isDash ? await deps.documents.forDashboard(to, target, { now }) : await deps.documents.forReport(to, target, { now });
        } catch (err) {
          if (!(err instanceof AccessError) && !(err instanceof SpecError)) throw err;
          out.skipped += 1;
          await log(to.id, 'skipped', err instanceof AccessError ? 'Their role does not include these records.' : err.message);
          continue;
        }
        // A file (CSV, Excel, PDF) can only be downloaded, which is an export: without export permission the recipient gets the document.
        const mayExport = ctx.can(to, `${isDash ? 'dashboards' : 'reports'}.export`);
        const wanted = String(s.format ?? 'html');
        const format: FileKind = mayExport && ((wanted === 'csv' && !isDash) || wanted === 'xlsx' || wanted === 'pdf') ? wanted as FileKind : 'html';
        const content = await renderFile(doc, format, isDash ? 'dashboard' : 'report_definition');
        const snapshotId = await deps.snapshots.save({
          sourceType: isDash ? 'dashboard' : 'report', sourceId: target.id, scheduleId: s.id, title: doc.title, format,
          forUser: to, content, recordTypes: doc.recordTypes, restricted: doc.restricted,
        });
        out.snapshots.push(snapshotId);
        // A file goes out only when the schedule asks for it, the recipient may export (so `format`
        // is a file), and nothing restricted is in it: restricted figures are read after signing in.
        const email = emailMode(s.email);
        const attachment = email === 'attach' && format !== 'html' && !doc.restricted
          ? { filename: `${doc.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'report'}.${format}`, content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), contentType: FILE_TYPES[format] }
          : undefined;
        let detail: string | undefined;
        for (const channel of channels) {
          // The message names the schedule, not the figures: the snapshot is read after signing in.
          const r = await channel.deliver(ctx, to, {
            title: `Scheduled ${isDash ? 'dashboard' : 'report'} ready: ${s.name}`, body: 'Open it to see the figures as at the time it was produced.',
            route: `/reports/snapshots/${snapshotId}`, email, attachment,
          });
          detail = r.detail ?? detail;
          if (channel.key === 'email' && email === 'attach' && !attachment && r.emailed) {
            detail = `${detail} The file was not attached: ${doc.restricted ? 'it includes restricted records' : 'their role does not allow exporting'}.`;
          }
          if (channel.key === 'email' && attachment && r.emailed?.attached) {
            // A file sent out of the application is an export, so it is in the audit trail.
            await ctx.audit(null, {
              action: 'report_snapshot.export', recordType: 'report_snapshot', recordId: snapshotId,
              summary: `Emailed stored export "${doc.title}" to ${to.displayName} as ${format.toUpperCase()}${doc.restricted ? ' (includes restricted records)' : ''}`,
            });
          }
        }
        out.delivered += 1;
        await log(to.id, 'delivered', detail ?? null, snapshotId);
      } catch (err) {
        console.error('[reports] scheduled delivery failed:', err);
        out.failed += 1;
        await log(to.id, 'failed', 'The document could not be produced.');
      }
    }
    if (!recipients.length) await log(null, 'skipped', 'No active recipients.');
  }

  const status = `${out.delivered} delivered, ${out.skipped} skipped, ${out.failed} failed`;
  await ctx.db.query('update report_schedules set last_run_at = $2, last_status = $3, next_run_at = $4 where id = $1',
    [s.id, now.toISOString(), status, nextRun(s as { cadence: string }, now).toISOString()]);
  // Each delivery is an export of data to a person, so the run is in the audit trail.
  await ctx.audit(null, {
    action: 'report_schedule.run', recordType: 'report_schedule', recordId: s.id,
    summary: `Scheduled delivery "${s.name}": ${status}`, after: { snapshots: out.snapshots.length, target_type: s.target_type, target_id: s.target_id },
  });
  // Counts only, never the figures (E13-19).
  if (out.delivered) {
    await emitWebhookEvent(ctx.app, {
      event: 'report_schedule.delivered', record: { type: 'report_schedule', id: s.id },
      data: { name: s.name, delivered: out.delivered, skipped: out.skipped, failed: out.failed },
    });
  }
  return out;
}

/** Runs every active schedule whose time has come. Safe to call as often as you like. */
export async function runDueSchedules(ctx: ModuleContext, deps: ScheduleDeps, now: Date = new Date()): Promise<RunSummary[]> {
  const due = await ctx.db.query<Row>(
    `select * from report_schedules where deleted_at is null and active and next_run_at is not null and next_run_at <= $1 order by next_run_at`, [now.toISOString()],
  );
  const out: RunSummary[] = [];
  for (const s of due) {
    // Claimed before anything is sent (BS-3): the next run time moves on in one statement, only while
    // the schedule is still due, so of two overlapping runs (the job and the "Run due" button, two servers, or a job
    // that outlived its lease) exactly one delivers it. A run stopped half-way is not repeated on
    // restart: recipients not reached then get the next delivery, rather than others getting two.
    const claimed = await ctx.db.one<Row>(
      `update report_schedules set next_run_at = $3, last_run_at = $4
       where id = $1 and next_run_at <= $2 and deleted_at is null and active returning id`,
      [s.id, now.toISOString(), nextRun(s as { cadence: string }, now).toISOString(), now.toISOString()],
    );
    if (claimed) out.push(await runSchedule(ctx, deps, s, now));
  }
  return out;
}
