// Asking vendors for certificates of insurance by email (E46-65). A request (CIR-) names the vendor or
// contract, the lines of coverage wanted (by default those the contract requires), the address it goes
// to and the date it is needed by. Sending it emails a personal upload link through the configured
// mail server (no outside service): the vendor opens it without an account, sends each certificate (the
// file and its details: line, insurer, policy number, dates, limits, additional insured, waiver), and
// says when they are done. Each certificate lands as a certificate of insurance "Sent by the vendor, to
// review", with the file on its Evidence files tab, and the person following the request up is told;
// staff check it against the file and set it Accepted (it is then checked against the contract) or
// Rejected. Before the link expires the vendor is reminded by email with the same link.
//
// The link, as with vendor response and call-out links: 32 random bytes; a SHA-256 hash is kept to
// check it and the secret itself sealed with the installation's key (core secret box) so that a
// reminder can carry the same link; it is never in an answer, the delivery log or the audit log. It
// travels in the address's fragment (`/certificate-upload#<secret>`), which browsers never send to the
// server, and the upload page sends it in a header, so it is never in a request line or a log. It
// works until it expires (30 days as installed, at most 90), the request is canceled or the area is
// switched off, and only while an administrator has switched requests on. The public routes are rate
// limited per address, answer the same "not valid" for any link that does not work, and every file
// goes through the attachments module's own intake (type, content, malware scanner, size).
import { createHash, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { requireRecentAuth, secretBox } from '../../core/auth.ts';
import { actorOf, dataLoadFor, isDataLoad } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import { ensureMail } from '../../core/mail/index.ts';
import { expiresText } from '../../core/mail/links.ts';
import { EMAIL_RE } from '../../core/mail/service.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { organizationName, readOrganization } from '../../core/organization.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { clientIp } from '../../core/request.ts';
import { todayInZone } from '../../core/timezone.ts';
import { typeGroup } from '../attachments/filetypes.ts';
import { canReceiveFiles, discardReceived, insertAttachment, prepareFile, receiveFile, type Refusal } from '../attachments/intake.ts';
import { formatBytes, readSettings as fileSettings } from '../attachments/service.ts';
import { queueFileTexts } from '../attachments/text.ts';
import { CERTIFICATE } from './certificates.ts';
import { DEFAULT_LINK_DAYS, LINK_DAYS, LINKS_ENABLED, MAX_LINK_DAYS, stepsOf } from './settings.ts';

export const CERT_REQUEST = 'insurance_certificate_request';
/** Where files wait between the upload and the certificate they belong to. Not a record type. */
export const HOLD_TYPE = 'insurance_certificate_upload';
export const TOKEN_HEADER = 'x-upload-token';
export const uploadPath = (token: string) => `/certificate-upload#${token}`;
export const NOT_VALID = 'This link is not valid. It may have expired or been withdrawn; ask your contact at the organization for a new one.';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hash = (token: string) => createHash('sha256').update(`insurance-coi:${token}`).digest('hex');
const sealContext = (id: string) => `insurance:certificate-request:${id}`;
/** What a vendor may send through one link. */
const MAX_FILES = 10;
const MAX_BYTES = 25 * 1024 * 1024;
const FILE_TYPES = ['pdf', 'png', 'jpg', 'jpeg'];
const EMAILS_PER_DAY = 5;
const UPLOADS_PER_HOUR = 30;
const HOUR = 3_600_000;
const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const clean = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};
const OPEN = ['draft', 'sent'];

export async function registerRequests(ctx: ModuleContext, recheck: (vendorId: string | null) => Promise<unknown>) {
  const { app, db } = ctx;
  const mail = await ensureMail(ctx);
  const perMinute = makeDbLimiter(db, 'insurance_coi_link', 60, 60_000);
  const wrong = makeDbLimiter(db, 'insurance_coi_link_bad', 20, 15 * 60_000);
  const perRequest = makeDbLimiter(db, 'insurance_coi_email', EMAILS_PER_DAY, 24 * HOUR);
  const uploads = makeDbLimiter(db, 'insurance_coi_upload', UPLOADS_PER_HOUR, HOUR);
  const contractsOn = () => Boolean(ctx.resources.get('contract'));
  const organization = async () => organizationName(await readOrganization(db));

  async function linkSettings() {
    const days = Math.round(Number(await ctx.settings.get<number>(LINK_DAYS, DEFAULT_LINK_DAYS)));
    return {
      enabled: (await ctx.settings.get<boolean>(LINKS_ENABLED, false)) === true,
      days: Number.isInteger(days) && days >= 1 && days <= MAX_LINK_DAYS ? days : DEFAULT_LINK_DAYS,
      max_days: MAX_LINK_DAYS,
      email_available: app.hasDecorator('mailEnabled') ? await app.mailEnabled() : false,
      files_available: canReceiveFiles(ctx),
    };
  }

  async function lineLabels(): Promise<Map<string, string>> {
    return new Map((await ctx.lookups.values('insurance_line')).map((v) => [v.value, v.label]));
  }

  // ---------- the request record ----------

  async function rules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const merged = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (!merged.vendor_id && !merged.contract_id) errors.vendor_id = 'Choose the vendor or the contract.';
    if (merged.email) {
      const email = String(merged.email).trim().toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Enter one email address, for example insurance@vendor.example.';
      else if ('email' in patch) patch.email = email;
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    if (!existing) {
      if (!merged.owner_id && req) patch.owner_id = actorOf(req).id;
      if (req && !isDataLoad(req)) patch.status = 'draft';
      // The lines the contract requires, when none are named.
      const lines = Array.isArray(merged.lines) ? merged.lines : [];
      if (!lines.length && merged.contract_id) {
        const req2 = await db.query<Row>('select distinct line from insurance_requirements where contract_id = $1 and deleted_at is null order by line', [merged.contract_id]);
        patch.lines = req2.map((r) => r.line);
      }
      if (!Array.isArray(patch.lines)) patch.lines = lines;
    } else if ('lines' in patch && !Array.isArray(patch.lines)) patch.lines = [];
    return patch;
  }

  ctx.defineResource({
    type: CERT_REQUEST, table: 'insurance_certificate_requests', module: 'insurance', label: 'Certificate request', plural: 'Certificate requests',
    path: '/api/insurance/certificate-requests', route: '/insurance/certificate-requests', titleField: 'title',
    ref: { field: 'ref', prefix: 'CIR-' },
    omit: ['token_hash', 'token_sealed', 'reminded_steps'],
    searchable: ['title', 'recipient_name', 'email', 'notes'],
    defaultSort: { field: 'created_at', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Request', type: 'text', required: true, personal: false, help: 'Made from the vendor when left empty.' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor', help: 'The vendor or contractor asked for its certificates.' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract', help: 'The contract whose insurance requirements the certificates answer; its vendor is filled in.' },
      lines: { label: 'Lines of coverage asked for', type: 'lookup', list: 'insurance_line', multiple: true, help: 'Those the contract requires when left empty.' },
      email: { label: 'Send to', type: 'text', personal: true, help: 'The email address the upload link goes to.' },
      recipient_name: { label: 'Recipient', type: 'text', personal: true },
      message: { label: 'Message', type: 'longtext', personal: false, help: 'A few words of your own for the email (optional).' },
      needed_by: { label: 'Needed by', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'insurance_request_status', default: 'draft' },
      owner_id: { label: 'Followed up by', type: 'user', help: 'Told when certificates arrive.' },
      link_expires_at: { label: 'Link works until', type: 'datetime', readOnly: true },
      sent_at: { label: 'Sent', type: 'datetime', readOnly: true },
      sent_by: { label: 'Sent by', type: 'user', readOnly: true },
      opened_at: { label: 'Opened by the vendor', type: 'datetime', readOnly: true },
      reminded_at: { label: 'Last reminder', type: 'datetime', readOnly: true },
      reminders: { label: 'Reminders sent', type: 'number', readOnly: true },
      submitted_at: { label: 'Vendor finished', type: 'datetime', readOnly: true },
      responder_name: { label: 'Sent by (vendor)', type: 'text', readOnly: true, personal: true },
      certificates: { label: 'Certificates received', type: 'number', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      prepare: async (_req, raw, existing) => {
        const input = { ...raw };
        const contract = input.contract_id ?? existing?.contract_id;
        if (!(input.vendor_id ?? existing?.vendor_id) && contract && contractsOn() && typeof contract === 'string' && UUID_RE.test(contract)) {
          const v = (await db.one<Row>('select vendor_id from contracts where id = $1', [contract]))?.vendor_id;
          if (v) input.vendor_id = v;
        }
        if (existing || (input.title && String(input.title).trim())) return input;
        const who = input.vendor_id && ctx.resources.get('vendor') && UUID_RE.test(String(input.vendor_id)) ? await ctx.resources.labelFor('vendor', String(input.vendor_id)) : null;
        return { ...input, title: `Certificates of insurance${who ? ` from ${who}` : ''}`.slice(0, 200) };
      },
      beforeCreate: (req, data) => rules(req, null, data),
      beforeUpdate: (req, existing, patch) => rules(req, existing, patch),
      // A canceled request's link stops working at once.
      afterUpdate: async (_req, before, after) => {
        if (after.status === 'canceled' && before.status !== 'canceled') {
          await db.query('update insurance_certificate_requests set token_hash = null, token_sealed = null where id = $1', [after.id]);
        }
      },
    },
  });

  // ---------- staff: switch requests on, send and remind ----------

  app.get('/api/insurance/certificate-requests/settings', { preHandler: ctx.requirePerm('insurance.view') }, async (req) => ({
    ...(await linkSettings()), can_administer: ctx.can(req.user, 'insurance.administer'),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/certificate-requests/settings', tag: 'Insurance', permission: 'insurance.view',
    summary: 'Whether vendors may be asked for certificates through an upload link, how long a link works, and whether email and files are available',
    response: '{ enabled, days, max_days, email_available, files_available, can_administer }',
  });

  app.put('/api/insurance/certificate-requests/settings', { preHandler: ctx.requirePerm('insurance.administer') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const now = await linkSettings();
    const errors: Record<string, string> = {};
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') errors.enabled = 'Send true or false.';
    const days = b.days === undefined ? undefined : Number(b.days);
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS)) errors.days = `Enter a whole number of days from 1 to ${MAX_LINK_DAYS}.`;
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    // Switching links on opens a way in for people outside the organization.
    if (b.enabled === true && !now.enabled) await requireRecentAuth({ db, audit: ctx.audit, settings: ctx.settings }, req, 'switching on certificate requests to vendors');
    if (days !== undefined && days !== now.days) await ctx.settings.set(LINK_DAYS, days, req);
    if (b.enabled !== undefined && b.enabled !== now.enabled) {
      await ctx.settings.set(LINKS_ENABLED, b.enabled, req);
      if (!b.enabled) await db.query(`update insurance_certificate_requests set token_hash = null, token_sealed = null where token_hash is not null`);
    }
    return { ...(await linkSettings()), can_administer: true };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/insurance/certificate-requests/settings', tag: 'Insurance', permission: 'insurance.administer',
    summary: 'Switch certificate requests to vendors on or off (off stops every link at once; on needs a recent password confirmation) and set how long a new link works',
    body: '{ enabled?: boolean, days?: 1-90 }',
  });

  async function requestFor(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id);
    const r = UUID_RE.test(id) ? await ctx.resources.find(CERT_REQUEST, id, req.user) : undefined;
    if (!r) return ctx.fail(404, 'not_found', 'Certificate request not found.');
    return r;
  }

  /** The email for a request: the organization, the vendor, the lines asked for, the date needed and the link. */
  async function compose(r: Row, token: string, reminder: boolean) {
    const org = await organization();
    const vendor = r.vendor_id && ctx.resources.get('vendor') ? await ctx.resources.labelFor('vendor', r.vendor_id) : null;
    const contract = r.contract_id && contractsOn() ? await ctx.resources.labelFor('contract', r.contract_id) : null;
    const labels = await lineLabels();
    const lines = (Array.isArray(r.lines) ? r.lines : []).map((l: string) => labels.get(l) ?? l);
    const expires = expiresText(r.link_expires_at).replace(/^on /, '');
    const subject = `${reminder ? 'Reminder: ' : ''}${org}: certificates of insurance${vendor ? ` from ${vendor}` : ''}`.slice(0, 200);
    const message = [
      `${org} asks ${vendor ?? 'you'} for current certificates of insurance${contract ? ` for the contract "${contract}"` : ''}.`,
      lines.length ? `Lines of coverage asked for: ${lines.join(', ')}.` : '',
      r.needed_by ? `They are needed by ${day(r.needed_by)}.` : '',
      r.message ? String(r.message) : '',
      `Open the link below to send each certificate (a PDF or a picture) with its details. No account is needed. The link works until ${expires}.`,
      'The link is meant for you: please do not forward it. If you were not expecting this message, you can ignore it.',
    ].filter(Boolean).join('\n\n');
    return { subject, message, link: uploadPath(token) };
  }

  async function queue(r: Row, token: string, reminder: boolean) {
    const m = await compose(r, token, reminder);
    // `accountLink` seals the link in the queued message, as for set-up links: it is opened only to send.
    await mail.queueOne({ template: 'message', purpose: 'insurance_certificate_request', data: m }, { to: r.email }, { accountLink: true }, { maxAttempts: 3 });
  }

  app.post('/api/insurance/certificate-requests/:id/send', { preHandler: ctx.requirePerm('insurance.edit') }, async (req) => {
    const r = await requestFor(req);
    const s = await linkSettings();
    if (await dataLoadFor(db, req)) ctx.fail(409, 'data_load', 'Nothing is sent in data load mode.');
    if (!s.enabled) ctx.fail(409, 'disabled', 'Certificate requests to vendors are switched off. An administrator can switch them on under Insurance > Settings.');
    if (!s.email_available) ctx.fail(409, 'email_off', 'Email is not set up, so the request cannot be sent. Ask an administrator to set up email.');
    if (!OPEN.includes(String(r.status))) ctx.fail(409, 'closed', 'This request is closed. Start a new one to ask the vendor again.');
    if (!r.email) ctx.fail(400, 'validation', 'Check the highlighted fields.', { email: 'Give the address the link goes to.' });
    if (await perRequest.blocked(r.id)) ctx.fail(429, 'rate_limited', `This request has been emailed ${EMAILS_PER_DAY} times today. Try again tomorrow.`);
    const b = (req.body ?? {}) as Row;
    const days = b.days === undefined || b.days === null || b.days === '' ? s.days : Number(b.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) ctx.fail(400, 'validation', 'Check the highlighted fields.', { days: `Enter a whole number of days from 1 to ${MAX_LINK_DAYS}.` });
    const token = randomBytes(32).toString('base64url');
    const who = actorOf(req);
    // A new link replaces any earlier one (its secret was in the earlier email only).
    const saved = (await db.one<Row>(
      `update insurance_certificate_requests set token_hash = $2, token_sealed = $3, link_expires_at = now() + make_interval(days => $4::int),
         sent_at = now(), sent_by = $5, status = 'sent', reminded_steps = '[]', updated_at = now(), updated_by = $5
       where id = $1 returning *`, [r.id, hash(token), secretBox(db).encrypt(token, sealContext(r.id)), days, who.id]))!;
    await perRequest.hit(r.id);
    await queue(saved, token, false);
    await ctx.audit(req, {
      action: 'insurance.certificate_request_send', recordType: CERT_REQUEST, recordId: r.id,
      summary: `Certificate request ${r.ref} emailed to ${saved.email}; the upload link works ${days} day${days === 1 ? '' : 's'}${r.sent_at ? ' and replaces the earlier one' : ''}`,
      after: { emailed_to: saved.email, link_expires_at: saved.link_expires_at },
    });
    return ctx.resources.find(CERT_REQUEST, r.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/certificate-requests/:id/send', tag: 'Insurance', permission: 'insurance.edit',
    summary: 'Email the request with a new personal upload link (requests must be switched on and email set up); an earlier link stops working',
    description: `At most ${EMAILS_PER_DAY} a day for one request. The secret is in the email only.`,
    body: '{ days?: 1-90 }', response: 'The request',
  });

  /** Emails a reminder with the same link (opened from its seal); false when the link cannot be recovered. */
  async function remindOne(r: Row): Promise<boolean> {
    if (!r.token_sealed || !r.email) return false;
    let token: string;
    try { token = secretBox(db).decrypt(r.token_sealed, sealContext(r.id)); } catch { return false; }
    await queue(r, token, true);
    await db.query('update insurance_certificate_requests set reminded_at = now(), reminders = reminders + 1 where id = $1', [r.id]);
    return true;
  }

  app.post('/api/insurance/certificate-requests/:id/remind', { preHandler: ctx.requirePerm('insurance.edit') }, async (req) => {
    const r0 = await requestFor(req);
    const r = (await db.one<Row>('select * from insurance_certificate_requests where id = $1', [r0.id]))!;
    if (await dataLoadFor(db, req)) ctx.fail(409, 'data_load', 'Nothing is sent in data load mode.');
    if (!(await linkSettings()).email_available) ctx.fail(409, 'email_off', 'Email is not set up, so no reminder can be sent.');
    if (r.status !== 'sent' || !r.token_hash || new Date(r.link_expires_at).getTime() <= Date.now()) ctx.fail(409, 'not_open', 'The link is no longer open. Send the request again to give the vendor a new link.');
    if (await perRequest.blocked(r.id)) ctx.fail(429, 'rate_limited', `This request has been emailed ${EMAILS_PER_DAY} times today. Try again tomorrow.`);
    await perRequest.hit(r.id);
    if (!(await remindOne(r))) ctx.fail(409, 'not_open', 'The link cannot be sent again. Send the request again to give the vendor a new link.');
    await ctx.audit(req, {
      action: 'insurance.certificate_request_remind', recordType: CERT_REQUEST, recordId: r.id,
      summary: `Reminder for certificate request ${r.ref} emailed to ${r.email}`,
    });
    return ctx.resources.find(CERT_REQUEST, r.id, req.user);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/certificate-requests/:id/remind', tag: 'Insurance', permission: 'insurance.edit',
    summary: 'Email the vendor a reminder now, with the same upload link', response: 'The request',
  });

  // Daily: each step of the reminder setting (days before the link expires) once per link.
  async function remindDue(): Promise<{ reminded: number }> {
    const s = await linkSettings();
    if (!s.enabled || !s.email_available) return { reminded: 0 };
    const steps = await stepsOf(ctx, 'request');
    const rows = await db.query<Row>(
      `select * from insurance_certificate_requests where deleted_at is null and status = 'sent' and token_hash is not null and submitted_at is null
         and link_expires_at > now() and link_expires_at <= now() + make_interval(days => $1::int) and sent_at < now() - interval '12 hours'
       limit 1000`, [Math.max(...steps)]);
    let reminded = 0;
    for (const r of rows) {
      const left = Math.max(0, Math.floor((new Date(r.link_expires_at).getTime() - Date.now()) / (24 * HOUR)));
      const step = [...steps].sort((a, b) => a - b).find((x) => left <= x);
      const done = Array.isArray(r.reminded_steps) ? (r.reminded_steps as number[]) : [];
      if (step === undefined || done.includes(step)) continue;
      // Once per step: recorded before sending, so a failure never sends twice.
      await db.query(`update insurance_certificate_requests set reminded_steps = $2::jsonb where id = $1`, [r.id, JSON.stringify([...done, step])]);
      if (await remindOne(r)) {
        reminded++;
        await ctx.audit(null, {
          action: 'insurance.certificate_request_remind', recordType: CERT_REQUEST, recordId: r.id,
          summary: `Reminder for certificate request ${r.ref} emailed to ${r.email}: the link expires ${expiresText(r.link_expires_at)}`,
        });
      }
    }
    return { reminded };
  }
  await scheduleWork(ctx, 'insurance.certificate_request_reminders', remindDue, { every: 6 * HOUR, firstRunInMs: 175_000 });

  // ---------- public: the vendor's side ----------

  async function openLink(req: FastifyRequest): Promise<Row> {
    const ip = clientIp(req);
    if (await wrong.blocked(ip) || await perMinute.blocked(ip)) ctx.fail(429, 'rate_limited', 'Too many requests. Wait a few minutes and try again.');
    await perMinute.hit(ip);
    const raw = req.headers[TOKEN_HEADER];
    const token = typeof raw === 'string' ? raw.trim() : '';
    const r = (await linkSettings()).enabled && TOKEN_RE.test(token)
      ? await db.one<Row>('select * from insurance_certificate_requests where token_hash = $1 and deleted_at is null', [hash(token)])
      : undefined;
    if (!r || r.status !== 'sent' || new Date(r.link_expires_at).getTime() <= Date.now()) {
      await wrong.hit(ip);
      ctx.fail(404, 'not_found', NOT_VALID);
    }
    return r!;
  }

  async function held(requestId: string): Promise<Row[]> {
    if (!canReceiveFiles(ctx)) return [];
    return db.query<Row>(`select * from attachments where record_type = $1 and record_id = $2 and deleted_at is null order by created_at, id`, [HOLD_TYPE, requestId]);
  }
  const publicFile = (f: Row) => ({ id: f.id, file_name: f.file_name, type_group: typeGroup(f.extension), size_bytes: Number(f.size_bytes), uploaded_at: f.created_at });

  async function uploadLimits() {
    if (!canReceiveFiles(ctx)) return { available: false, max_files: 0, max_bytes: 0, max_file_bytes: 0, file_types: [] as string[] };
    const f = await fileSettings(ctx);
    const types = FILE_TYPES.filter((x) => f.allowedExtensions.includes(x));
    return { available: types.length > 0, max_files: MAX_FILES, max_bytes: MAX_BYTES, max_file_bytes: Math.min(f.maxBytes, MAX_BYTES), file_types: types };
  }

  async function publicView(r: Row) {
    const labels = await lineLabels();
    const vendor = r.vendor_id && ctx.resources.get('vendor') ? await db.one<Row>('select name from vendors where id = $1', [r.vendor_id]) : undefined;
    const contract = r.contract_id && contractsOn() ? await db.one<Row>('select title from contracts where id = $1', [r.contract_id]) : undefined;
    // What the contract requires of each line asked for: what the vendor needs to know, nothing more.
    const requirements = r.contract_id && contractsOn() ? await db.query<Row>(
      `select line, min_per_occurrence, min_aggregate, additional_insured, waiver_of_subrogation from insurance_requirements
       where contract_id = $1 and deleted_at is null order by line`, [r.contract_id]) : [];
    const lines = (Array.isArray(r.lines) ? r.lines as string[] : []).map((l) => {
      const q = requirements.find((x) => x.line === l);
      return {
        line: l, label: labels.get(l) ?? l,
        min_per_occurrence: q?.min_per_occurrence == null ? null : Number(q.min_per_occurrence), min_aggregate: q?.min_aggregate == null ? null : Number(q.min_aggregate),
        additional_insured: Boolean(q?.additional_insured), waiver_of_subrogation: Boolean(q?.waiver_of_subrogation),
      };
    });
    const sent = await db.query<Row>(
      `select c.ref, c.line, c.expires_on::text as expires_on, c.created_at from insurance_certificates c
       where c.request_id = $1 and c.deleted_at is null order by c.created_at`, [r.id]);
    return {
      organization: await organization(), vendor_name: vendor?.name ?? null, contract_title: contract?.title ?? null,
      lines, all_lines: [...labels.entries()].map(([value, label]) => ({ value, label })),
      needed_by: day(r.needed_by), expires_at: r.link_expires_at, submitted_at: r.submitted_at, responder_name: r.responder_name,
      certificates: sent.map((c) => ({ ref: c.ref, line: c.line, line_label: labels.get(c.line) ?? c.line, expires_on: c.expires_on, sent_at: c.created_at })),
      files: (await held(r.id)).map(publicFile),
      upload: await uploadLimits(),
    };
  }

  app.get('/api/insurance/certificate-upload', { config: { public: true } }, async (req) => {
    const r = await openLink(req);
    if (!r.opened_at) {
      await db.query('update insurance_certificate_requests set opened_at = now() where id = $1', [r.id]);
      await ctx.audit(req, { action: 'insurance.certificate_request_open', recordType: CERT_REQUEST, recordId: r.id, summary: `Vendor opened the upload link of certificate request ${r.ref}` });
    }
    return publicView(r);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/insurance/certificate-upload', tag: 'Insurance', public: true,
    summary: 'What a certificate request asks for, the certificates sent so far and the files waiting (no account; the link\'s secret in the X-Upload-Token header; rate limited)',
  });

  await app.register(async (scoped) => {
    // The file is the request body, as for any other upload: never buffered in memory.
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
    scoped.put('/api/insurance/certificate-upload/files', { config: { public: true } }, async (req, reply) => {
      const r = await openLink(req);
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') ctx.fail(415, 'unsupported_media_type', 'Send the file as the request body with the content type application/octet-stream.');
      const limits = await uploadLimits();
      if (!limits.available) ctx.fail(409, 'files_off', 'Files cannot be sent through this link. Send them to your contact instead.');
      if (r.submitted_at) ctx.fail(409, 'submitted', 'You have said you are done. Ask your contact if something needs to change.');
      if (await uploads.blocked(r.id)) ctx.fail(429, 'rate_limited', 'Too many files sent in a short time. Wait a while and try again.');
      await uploads.hit(r.id);
      const q = (req.query ?? {}) as Row;
      let fileName = 'file';
      const refuse = async (refusal: Refusal): Promise<never> => {
        if (refusal.audit) {
          await ctx.audit(req, { action: 'insurance.certificate_upload_refused', recordType: CERT_REQUEST, recordId: r.id, summary: `File sent through certificate request ${r.ref} refused: ${fileName} (${refusal.reason})` });
        }
        return ctx.fail(refusal.status, refusal.code, refusal.message);
      };
      const all = await db.one<Row>(
        `select count(*)::int as files, coalesce(sum(size_bytes), 0)::bigint as bytes from attachments
         where deleted_at is null and ((record_type = $1 and record_id = $2) or (record_type = $3 and record_id in (select id from insurance_certificates where request_id = $2)))`,
        [HOLD_TYPE, r.id, CERTIFICATE]);
      if (Number(all?.files ?? 0) >= MAX_FILES) return refuse({ status: 409, code: 'quota', message: `You can send up to ${MAX_FILES} files through this link.`, reason: 'too many files', audit: true });
      const room = MAX_BYTES - Number(all?.bytes ?? 0);
      if (room <= 0) return refuse({ status: 413, code: 'quota', message: `The files sent through this link already reach the limit of ${formatBytes(MAX_BYTES)}.`, reason: 'size limit reached', audit: true });
      const prepared = await prepareFile(ctx, q.name, { maxBytes: room, allowedExtensions: limits.file_types });
      fileName = prepared.ok ? prepared.file.fileName : prepared.fileName;
      if (!prepared.ok) return refuse(prepared.refusal);
      const received = await receiveFile(ctx, prepared.file, body!, Number(req.headers['content-length']));
      if (!received.ok) return refuse(received.refusal);
      const file = received.file;
      const row = await db.tx(async (tx) => {
        const open = await tx.one<Row>(`select id from insurance_certificate_requests where id = $1 and status = 'sent' and submitted_at is null and link_expires_at > now() for update`, [r.id]);
        if (!open) return null;
        return insertAttachment(tx, file, {
          recordType: HOLD_TYPE, recordId: r.id, kind: 'evidence', description: 'Certificate of insurance sent by the vendor',
          uploadedByName: `${r.responder_name ?? 'Vendor'} (certificate request ${r.ref})`, userId: null,
        });
      });
      if (!row) {
        await discardReceived(ctx, file);
        return ctx.fail(409, 'submitted', 'This link no longer accepts files.');
      }
      await ctx.audit(req, {
        action: 'insurance.certificate_upload', recordType: CERT_REQUEST, recordId: r.id,
        summary: `Vendor sent a file through certificate request ${r.ref}: ${file.fileName} (${formatBytes(file.size)})`,
        after: { attachment_id: row.id, file_name: file.fileName, size_bytes: file.size, sha256: file.sha256, scan_status: file.scanStatus },
      });
      reply.code(201);
      return { ...publicFile(row), ...(file.scanUnavailable ? { scan_warning: file.scanUnavailable.warning } : {}) };
    });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/insurance/certificate-upload/files', tag: 'Insurance', public: true,
    summary: 'Send one certificate file through a request\'s upload link (the request body, application/octet-stream; `name` in the query); it waits until its details are sent',
    description: `PDF or pictures, at most ${MAX_FILES} files and ${formatBytes(MAX_BYTES)} for one link; the same checks as any upload (type, content, malware scanner, size).`,
    query: { name: { type: 'string', description: 'The file name, with its extension' } },
  });

  app.delete('/api/insurance/certificate-upload/files/:fid', { config: { public: true } }, async (req) => {
    const r = await openLink(req);
    const fid = String((req.params as Row).fid ?? '');
    const f = UUID_RE.test(fid) ? await db.one<Row>('select * from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null', [fid, HOLD_TYPE, r.id]) : undefined;
    if (!f) return ctx.fail(404, 'not_found', 'File not found.');
    await discardReceived(ctx, { driver: f.storage_driver, key: f.storage_key });
    await db.query(`update attachments set deleted_at = now(), purged_at = now(), removed_reason = 'withdrawn', updated_at = now() where id = $1`, [f.id]);
    await ctx.audit(req, { action: 'insurance.certificate_upload_withdraw', recordType: CERT_REQUEST, recordId: r.id, summary: `Vendor removed a file sent through certificate request ${r.ref}: ${f.file_name}` });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/insurance/certificate-upload/files/:fid', tag: 'Insurance', public: true,
    summary: 'Remove a file sent through a request\'s upload link before its details are sent',
  });

  const money = (v: unknown, field: string, errors: Record<string, string>) => {
    if (v === undefined || v === null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n < 0) { errors[field] = 'Enter an amount of zero or more.'; return null; }
    return n;
  };
  const date = (v: unknown, field: string, errors: Record<string, string>) => {
    if (v === undefined || v === null || v === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) { errors[field] = 'Enter a date.'; return null; }
    return String(v);
  };

  app.post('/api/insurance/certificate-upload/certificates', { config: { public: true } }, async (req, reply) => {
    const r = await openLink(req);
    if (r.submitted_at) ctx.fail(409, 'submitted', 'You have said you are done. Ask your contact if something needs to change.');
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const labels = await lineLabels();
    const line = String(b.line ?? '');
    if (!labels.has(line)) errors.line = 'Choose the line of coverage.';
    const effective = date(b.effective_on, 'effective_on', errors);
    const expires = date(b.expires_on, 'expires_on', errors);
    if (!expires && !errors.expires_on) errors.expires_on = 'Give the day the coverage ends.';
    if (effective && expires && expires < effective) errors.expires_on = 'The coverage cannot end before it starts.';
    const occ = money(b.limit_per_occurrence, 'limit_per_occurrence', errors);
    const agg = money(b.limit_aggregate, 'limit_aggregate', errors);
    const insurer = clean(b.insurer_name, 200);
    if (!insurer) errors.insurer_name = 'Give the insurer\'s name.';
    const name = clean(b.responder_name, 120) ?? r.responder_name;
    if (!name) errors.responder_name = 'Give your name, so we know who sent it.';
    const fileId = b.file_id ? String(b.file_id) : null;
    const files = await uploadLimits();
    let file: Row | undefined;
    if (fileId) {
      file = UUID_RE.test(fileId) ? await db.one<Row>('select * from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null', [fileId, HOLD_TYPE, r.id]) : undefined;
      if (!file) errors.file_id = 'Send the certificate file again.';
    } else if (files.available) errors.file_id = 'Attach the certificate (a PDF or a picture).';
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);

    // A certificate to review: made as system work (no account), named after the vendor and the line.
    const made = await ctx.resources.create(CERTIFICATE, {
      title: '', vendor_id: r.vendor_id ?? null, contract_id: r.contract_id ?? null, line, insurer_name: insurer,
      policy_number: clean(b.policy_number, 100), effective_on: effective, expires_on: expires, limit_per_occurrence: occ, limit_aggregate: agg,
      additional_insured: b.additional_insured === true, waiver_of_subrogation: b.waiver_of_subrogation === true,
      received_on: todayInZone(), status: 'to_review', owner_id: r.owner_id ?? null, request_id: r.id,
      notes: `Sent by ${name} through certificate request ${r.ref}. Check the details against the file, then set it to Accepted or Rejected.`,
    }, null);
    if (file) {
      await db.query(`update attachments set record_type = $2, record_id = $3, kind = 'evidence', updated_at = now() where id = $1 and record_type = $4`,
        [file.id, CERTIFICATE, made.id, HOLD_TYPE]);
      await queueFileTexts(ctx);
    }
    await db.query(`update insurance_certificate_requests set responder_name = $2, certificates = certificates + 1 where id = $1`, [r.id, name]);
    await ctx.audit(req, {
      action: 'insurance.certificate_upload_certificate', recordType: CERT_REQUEST, recordId: r.id,
      summary: `Vendor sent certificate ${made.ref} (${labels.get(line)}) through certificate request ${r.ref} (${name}); it waits for review`,
      after: { certificate_id: made.id, attachment_id: file?.id ?? null },
    });
    if (app.hasDecorator('notify') && (r.owner_id || r.created_by)) {
      await app.notify({
        userIds: [r.owner_id ?? r.created_by], kind: 'general', recordType: CERTIFICATE, recordId: made.id,
        title: `A certificate of insurance arrived for review: ${made.title}`,
        body: `Sent through certificate request ${r.ref}. Check the details against the file, then set it to Accepted or Rejected.`,
      }).catch(() => undefined);
    }
    reply.code(201);
    return publicView((await db.one<Row>('select * from insurance_certificate_requests where id = $1', [r.id]))!);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/certificate-upload/certificates', tag: 'Insurance', public: true,
    summary: 'Send one certificate through a request\'s upload link: its details and the file sent before; it becomes a certificate of insurance waiting for review',
    body: '{ file_id, line, insurer_name, policy_number?, effective_on?, expires_on, limit_per_occurrence?, limit_aggregate?, additional_insured?, waiver_of_subrogation?, responder_name }',
  });

  app.post('/api/insurance/certificate-upload/done', { config: { public: true } }, async (req) => {
    const r = await openLink(req);
    if (r.submitted_at) return publicView(r);
    const b = (req.body ?? {}) as Row;
    const name = clean(b.responder_name, 120) ?? r.responder_name;
    if (!name) ctx.fail(400, 'validation', 'Check the highlighted fields.', { responder_name: 'Give your name, so we know who sent the certificates.' });
    if (!r.certificates) ctx.fail(400, 'nothing_sent', 'Send at least one certificate first.');
    // Files sent but never described are discarded: nothing waits unseen.
    for (const f of await held(r.id)) {
      await discardReceived(ctx, { driver: f.storage_driver, key: f.storage_key });
      await db.query(`update attachments set deleted_at = now(), purged_at = now(), removed_reason = 'unreviewed', updated_at = now() where id = $1`, [f.id]);
    }
    const saved = (await db.one<Row>(
      `update insurance_certificate_requests set submitted_at = now(), responder_name = $2, status = 'received', token_hash = null, token_sealed = null, updated_at = now()
       where id = $1 returning *`, [r.id, name]))!;
    await ctx.audit(req, { action: 'insurance.certificate_request_done', recordType: CERT_REQUEST, recordId: r.id, summary: `Vendor finished certificate request ${r.ref} (${name}) with ${r.certificates} certificate${r.certificates === 1 ? '' : 's'}` });
    if (app.hasDecorator('notify') && (r.owner_id || r.created_by)) {
      await app.notify({
        userIds: [r.owner_id ?? r.created_by], kind: 'general', recordType: CERT_REQUEST, recordId: r.id,
        title: `${r.title}: the vendor has sent ${r.certificates} certificate${r.certificates === 1 ? '' : 's'}`,
        body: 'Review each one on the Certificates tab (status "Sent by the vendor, to review").',
      }).catch(() => undefined);
    }
    await recheck(r.vendor_id ?? null);
    return { ...(await publicView({ ...saved, status: 'received' })), done: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/insurance/certificate-upload/done', tag: 'Insurance', public: true,
    summary: 'Say the certificates are all sent: the link closes and the request is marked as received', body: '{ responder_name }',
  });
}
