// The application emails a vendor response link (E06-23).
//
// Only when email is switched on (Administration > Email). The link's secret is never stored, so
// sending creates a new link (any open one stops working) and puts it in that one message: the
// link is sealed in the queued message the same way account set-up links are (core/mail), never
// written to the delivery log, the audit log or the answer. The message names the organization,
// the vendor and the assessment, in plain text and HTML. At most a few messages a day for one
// assessment. Before an emailed link expires, its recipient gets one reminder (without the
// link, which cannot be sent again); `vendors.response_link_reminder_days`, 0 = never.
import type { ModuleContext, Row } from '../../core/module.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import { ensureMail } from '../../core/mail/index.ts';
import { expiresText } from '../../core/mail/links.ts';
import { EMAIL_RE } from '../../core/mail/service.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import type { LinkKit } from './responseLinks.ts';

/** Emails of a link for one assessment in a day. */
const EMAILS_PER_DAY = 5;
const HOUR = 3_600_000;

export async function registerResponseEmail(ctx: ModuleContext, kit: LinkKit) {
  const { app, db } = ctx;
  const mail = await ensureMail(ctx);
  const perAssessment = makeDbLimiter(db, 'vendor_link_email', EMAILS_PER_DAY, 24 * HOUR);
  const organization = () => ctx.settings.get<string>('app.name', 'Sandpiper GRC');

  app.post('/api/vendor-assessments/:aid/links/email', { preHandler: ctx.requirePerm('vendors.edit') }, async (req, reply) => {
    const s = await kit.settings();
    if (!s.enabled) ctx.fail(409, 'disabled', 'Vendor response links are switched off. An administrator can switch them on under Assessment questions.');
    if (!s.email_available) ctx.fail(409, 'email_off', 'Email is not set up, so the link cannot be sent from here. Create the link and send it yourself, or ask an administrator to set up email.');
    const a = await kit.needDraft(req);
    if (a.status !== 'draft') ctx.fail(409, 'completed', 'This assessment is completed. Start a new one to ask the vendor again.');
    const b = (req.body ?? {}) as Row;
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { email: 'Enter one email address, for example security@vendor.example.' });
    if (await perAssessment.blocked(a.id)) ctx.fail(429, 'rate_limited', `The link for this assessment has been emailed ${EMAILS_PER_DAY} times today. Try again tomorrow, or create a link and send it yourself.`);

    const { row, token } = await kit.createLink(req, a, { recipient: b.recipient ?? email, days: b.days }, `; emailed to ${email}`);
    await perAssessment.hit(a.id);
    const org = await organization();
    const expires = expiresText(row.expires_at).replace(/^on /, '');
    const files = s.files_available && s.max_files > 0;
    const subject = `${org}: assessment questions for ${a.vendor.name}`;
    const message = [
      `${org} asks ${a.vendor.name} to answer the questions of its assessment "${a.set_title}".`,
      `Open the link below to answer. No account is needed. You can save your answers and come back${files ? ', and send supporting files such as certificates or reports' : ''}. The link works until ${expires}.`,
      'The link is meant for you: please do not forward it. If you were not expecting this message, you can ignore it.',
    ].join('\n\n');
    // The "Vendor response link" template (E06-25); `subject` and `message` name it in the delivery log.
    // `accountLink` seals the link in the queued message, as for set-up links: it is decrypted only to send.
    await mail.queueOne(
      {
        template: 'vendor_response_link', purpose: 'vendor_response',
        data: { subject, message, link: `/vendor-response/${token}`, organization: org, vendorName: a.vendor.name, assessmentTitle: a.set_title, expiresAt: expires },
      },
      { to: email }, { accountLink: true }, { maxAttempts: 3 },
    );
    const saved = (await db.one<Row>(
      'update vendor_assessment_links set emailed_to = $2, emailed_at = now() where id = $1 returning *', [row.id, email]))!;
    await ctx.audit(req, {
      action: 'vendor.response_link_email', recordType: 'vendor', recordId: a.vendor_id,
      summary: `Response link for the assessment of ${a.vendor.name} emailed to ${email}`,
      after: { assessment_id: a.id, link_id: row.id, emailed_to: email, expires_at: row.expires_at },
    });
    reply.code(201);
    // The secret went into the message only; staff never see it.
    return kit.linkView({ ...saved, assessment_status: 'draft', created_by_name: req.user!.displayName });
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-assessments/:aid/links/email', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Create a new response link and email it (email must be on); the earlier open link stops working, and the secret is in the email only',
    description: `At most ${EMAILS_PER_DAY} a day for one assessment. The answer describes the link without its secret.`,
    body: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, recipient: { type: 'string' }, days: { type: 'integer', minimum: 1, maximum: 90 } } },
  });

  await scheduleWork(ctx, 'vendors.response_link_reminders', async () => ({ reminded: await remindBeforeExpiry() }), { every: HOUR, firstRunInMs: 80_000 });

  /** One reminder per emailed link, `reminder_days` before it expires, while no answers have been sent. */
  async function remindBeforeExpiry(): Promise<number> {
    const s = await kit.settings();
    if (!s.enabled || !s.email_available || s.reminder_days === 0) return 0;
    const due = await db.query<Row>(
      `update vendor_assessment_links l set reminded_at = now()
       from vendor_assessments a, vendor_question_sets q, vendors v
       where a.id = l.assessment_id and q.id = a.question_set_id and v.id = a.vendor_id
         and a.status = 'draft' and a.deleted_at is null
         and l.emailed_to is not null and l.reminded_at is null and l.submitted_at is null and l.revoked_at is null
         and l.expires_at > now() and l.expires_at <= now() + make_interval(days => $1::int)
         and l.emailed_at < now() - interval '12 hours'
       returning l.id, l.emailed_to, l.emailed_at, l.expires_at, a.vendor_id, q.title, v.name as vendor_name`, [s.reminder_days]);
    if (!due.length) return 0;
    const org = await organization();
    for (const l of due) {
      const expires = expiresText(l.expires_at);
      // The "Vendor response link reminder" template (E06-25); `subject` names the message in the delivery log.
      await mail.queueOne({
        template: 'vendor_response_reminder', purpose: 'vendor_response',
        data: {
          subject: `Reminder: ${org} assessment questions for ${l.vendor_name}`,
          organization: org, vendorName: l.vendor_name, assessmentTitle: l.title, expiresAt: expires,
          sentAt: expiresText(l.emailed_at).replace(/^on /, ''),
        },
      }, { to: l.emailed_to }, {}, { maxAttempts: 3 });
      await ctx.audit(null, {
        action: 'vendor.response_link_remind', recordType: 'vendor', recordId: l.vendor_id,
        summary: `Reminder emailed to ${l.emailed_to}: the response link expires ${expires}`, after: { link_id: l.id },
      });
    }
    return due.length;
  }
}
