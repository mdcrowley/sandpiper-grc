// Outbound email as a service: `app.sendMail(...)` and `app.mailEnabled()` (E14-04).
//
// Off by default: nothing is queued or sent until an administrator saves a mail server and
// switches email on (Administration > Email). Then, from any module, guarded:
//
//   if (ctx.app.hasDecorator('sendMail')) {
//     await ctx.app.sendMail({ userIds: [owner], template: 'message', purpose: 'reports',
//       data: { subject: 'Monthly service report', message: 'Your report is ready.', link: `/reports/runs/${id}` },
//       record: { type: 'report_definition', id: defId }, attachments: [{ filename, contentBase64, contentType }] });
//   }
//
// `ensureMail` is idempotent: the first caller applies the migrations, writes the default
// templates, registers the `mail.send` job and the routes, and decorates the application.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureJobs } from '../jobs/index.ts';
import { migrate } from '../migrate.ts';
import type { ModuleContext } from '../module.ts';
import { registerAccountLinks } from './links.ts';
import { ensureTemplates, registerMailRoutes } from './routes.ts';
import { makeMail, type MailService } from './service.ts';

export { registerMailProvider, type MailAttachment, type MailProvider, type MailResult, type OutgoingMessage } from './provider.ts';
export type { SendMailInput, SendMailResult } from './service.ts';
export { OWN_MAIL_HEADER } from './service.ts';
// Inbound mail (E15-06): a message reader and a POP3 client, used by email-to-ticket.
export { htmlToText, parseAddresses, parseMessage, stripQuoted, type ParsedAddress, type ParsedAttachment, type ParsedMessage } from './mime.ts';
export { Pop3, Pop3Error, type Pop3Message, type Pop3Options, type Pop3Tls } from './pop3.ts';

const here = dirname(fileURLToPath(import.meta.url));
const services = new WeakMap<object, MailService>();

export async function ensureMail(ctx: ModuleContext): Promise<MailService> {
  const known = services.get(ctx.app);
  if (known) return known;
  const jobs = await ensureJobs(ctx);
  await migrate(ctx.db, [{ scope: 'core.mail', dir: join(here, 'migrations') }]);
  await ensureTemplates(ctx);
  const mail = makeMail(ctx, jobs);
  services.set(ctx.app, mail);
  if (!ctx.app.hasDecorator('sendMail')) ctx.app.decorate('sendMail', mail.sendMail);
  if (!ctx.app.hasDecorator('mailEnabled')) ctx.app.decorate('mailEnabled', mail.enabled);
  registerMailRoutes(ctx, mail);
  registerAccountLinks(ctx, mail);
  return mail;
}
